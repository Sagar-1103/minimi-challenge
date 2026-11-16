import { prisma } from "../../lib/prisma";
import { embeddingService } from "../embedding.service";
import { env } from "../../config/env";
import type {
  MessageWithToolCalls,
  ToolCallRecord,
} from "../../types/conversation.types";
import { DateResolver } from "../date-resolver";
import { ambiguityHandler } from "./ambiguity-handler";
import { logger } from "../../utils/logger";

export interface HistoryMatch {
  message: MessageWithToolCalls;
  assistantResponse: MessageWithToolCalls | null;
  matchType: "exact_date" | "date_range" | "topic" | "combined";
  matchConfidence: number;
  conversationId?: string;
}

export interface MemoryRetrievalParams {
  userMessage: string;
  conversationId?: string;
  currentUserMessageId?: string;
  dateResolver: DateResolver;
}

export interface MemoryRetrievalResult {
  matches: HistoryMatch[];
  isExplicitRecall: boolean;
  recalledHistoryPrompt: string;
  ambiguousChoices?: HistoryMatch[];
  isReverify?: boolean;
}

export interface Exchange {
  userMessage: MessageWithToolCalls;
  assistantResponse: MessageWithToolCalls;
  toolCallRecords: ToolCallRecord[];
  timestamp: Date;
}

export interface SemanticSearchOptions {
  conversationId?: string;
  startDate?: Date;
  endDate?: Date;
  excludeMessageId?: string;
  threshold?: number;
  limit?: number;
  matchType?: "topic" | "combined";
}

export class HistoryRetriever {
  // Core pgvector semantic search method with cosine similarity ranking
  async findBySemanticSimilarity(
    queryText: string,
    options: SemanticSearchOptions = {}
  ): Promise<HistoryMatch[]> {
    const cleanQuery = queryText.trim();
    if (!cleanQuery) return [];

    const limit = options.limit ?? env.VECTOR_SEARCH_LIMIT ?? 5;
    const threshold = options.threshold ?? env.VECTOR_SEARCH_THRESHOLD ?? 0.45;

    try {
      const queryVector = await embeddingService.getEmbedding(cleanQuery);
      const isZeroVector = queryVector.every((v) => v === 0);

      if (!isZeroVector) {
        const vectorStr = `[${queryVector.join(",")}]`;

        const rawRows = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT 
            m.id, 
            m."conversationId", 
            m.role, 
            m.content, 
            m.timestamp,
            (1 - (m.embedding <=> $1::vector)) AS similarity
          FROM messages m
          WHERE m.embedding IS NOT NULL
            AND m.role = 'user'
            AND ($2::text IS NULL OR m."conversationId" = $2)
            AND ($3::timestamptz IS NULL OR m.timestamp >= $3)
            AND ($4::timestamptz IS NULL OR m.timestamp <= $4)
            AND ($5::text IS NULL OR m.id != $5)
            AND (1 - (m.embedding <=> $1::vector)) >= $6
          ORDER BY m.embedding <=> $1::vector ASC
          LIMIT $7;
          `,
          vectorStr,
          options.conversationId ?? null,
          options.startDate ? options.startDate.toISOString() : null,
          options.endDate ? options.endDate.toISOString() : null,
          options.excludeMessageId ?? null,
          threshold,
          limit
        );

        if (rawRows.length > 0) {
          logger.info(
            `pgvector semantic search found ${rawRows.length} matches for "${cleanQuery}" (top similarity: ${(rawRows[0].similarity * 100).toFixed(1)}%)`
          );
          return this.hydrateMatches(rawRows, options.matchType || "topic");
        }
      }
    } catch (err: any) {
      logger.warn(`pgvector query failed, falling back to substring search: ${err.message}`);
    }

    // Fallback: substring search if vector search returns no matches or embedding failed
    return this.fallbackSubstringSearch(cleanQuery, options);
  }

  // Fallback substring search to ensure legacy or non-embedded messages are still discoverable
  private async fallbackSubstringSearch(
    cleanTopic: string,
    options: SemanticSearchOptions
  ): Promise<HistoryMatch[]> {
    const userMessages = await prisma.message.findMany({
      where: {
        conversationId: options.conversationId,
        role: "user",
        id: options.excludeMessageId ? { not: options.excludeMessageId } : undefined,
        timestamp: {
          gte: options.startDate,
          lte: options.endDate,
        },
        content: {
          contains: cleanTopic,
          mode: "insensitive",
        },
      },
      orderBy: { timestamp: "desc" },
      take: options.limit ?? 5,
      include: {
        toolCalls: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const matches: HistoryMatch[] = [];
    for (const userMsg of userMessages) {
      const assistantResponse = await prisma.message.findFirst({
        where: {
          conversationId: userMsg.conversationId,
          role: "assistant",
          timestamp: {
            gte: userMsg.timestamp,
          },
        },
        orderBy: { timestamp: "asc" },
        include: {
          toolCalls: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      matches.push({
        message: userMsg,
        assistantResponse,
        matchType: options.matchType || "topic",
        matchConfidence: 0.75,
        conversationId: userMsg.conversationId,
      });
    }

    return matches;
  }

  // Hydrate raw SQL rows into full HistoryMatch objects with assistant responses and tool calls
  private async hydrateMatches(
    rows: any[],
    defaultMatchType: "topic" | "combined"
  ): Promise<HistoryMatch[]> {
    const matches: HistoryMatch[] = [];

    for (const row of rows) {
      const userMessage = await prisma.message.findUnique({
        where: { id: row.id },
        include: {
          toolCalls: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!userMessage) continue;

      const assistantResponse = await prisma.message.findFirst({
        where: {
          conversationId: userMessage.conversationId,
          role: "assistant",
          timestamp: {
            gte: userMessage.timestamp,
          },
        },
        orderBy: { timestamp: "asc" },
        include: {
          toolCalls: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      matches.push({
        message: userMessage,
        assistantResponse,
        matchType: defaultMatchType,
        matchConfidence: Number(row.similarity) || 0.85,
        conversationId: userMessage.conversationId,
      });
    }

    return matches;
  }

  // Query messages matching a date expression within a specific conversation
  async findByDate(
    conversationId: string,
    dateExpression: string,
    dateResolver: DateResolver,
    excludeMessageId?: string
  ): Promise<HistoryMatch[]> {
    const resolution = dateResolver.resolve(dateExpression);
    if (!resolution) return [];

    const year = resolution.resolvedDate.getUTCFullYear();
    const month = resolution.resolvedDate.getUTCMonth();
    const day = resolution.resolvedDate.getUTCDate();

    const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    const userMessages = await prisma.message.findMany({
      where: {
        conversationId,
        role: "user",
        id: excludeMessageId ? { not: excludeMessageId } : undefined,
        timestamp: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: { timestamp: "asc" },
      include: {
        toolCalls: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const matches: HistoryMatch[] = [];

    for (const userMsg of userMessages) {
      const assistantResponse = await prisma.message.findFirst({
        where: {
          conversationId,
          role: "assistant",
          timestamp: {
            gte: userMsg.timestamp,
          },
        },
        orderBy: { timestamp: "asc" },
        include: {
          toolCalls: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      matches.push({
        message: userMsg,
        assistantResponse,
        matchType: resolution.confidence === "exact" ? "exact_date" : "date_range",
        matchConfidence: resolution.confidence === "exact" ? 1.0 : 0.85,
        conversationId,
      });
    }

    return matches;
  }

  // Find messages containing specific topic via semantic similarity
  async findByTopic(
    conversationId: string,
    topic: string,
    excludeMessageId?: string
  ): Promise<HistoryMatch[]> {
    return this.findBySemanticSimilarity(topic, {
      conversationId,
      excludeMessageId,
      matchType: "topic",
      limit: 5,
    });
  }

  // Find messages matching both a date constraint and topic via semantic similarity
  async findByDateAndTopic(
    conversationId: string,
    dateExpression: string,
    topic: string,
    dateResolver: DateResolver,
    excludeMessageId?: string
  ): Promise<HistoryMatch[]> {
    const resolution = dateResolver.resolve(dateExpression);
    if (!resolution) {
      return this.findByTopic(conversationId, topic, excludeMessageId);
    }

    const year = resolution.resolvedDate.getUTCFullYear();
    const month = resolution.resolvedDate.getUTCMonth();
    const day = resolution.resolvedDate.getUTCDate();

    const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    return this.findBySemanticSimilarity(topic, {
      conversationId,
      startDate: startOfDay,
      endDate: endOfDay,
      excludeMessageId,
      matchType: "combined",
      limit: 5,
    });
  }

  // Load the complete round-trip exchange (question, answer, and executed tool calls)
  async getFullExchange(messageId: string): Promise<Exchange | null> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        toolCalls: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!message) return null;

    if (message.role === "user") {
      const assistantResponse = await prisma.message.findFirst({
        where: {
          conversationId: message.conversationId,
          role: "assistant",
          timestamp: {
            gte: message.timestamp,
          },
        },
        orderBy: { timestamp: "asc" },
        include: {
          toolCalls: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!assistantResponse) return null;

      const toolCallRecords = [
        ...(message.toolCalls || []),
        ...(assistantResponse.toolCalls || []),
      ];

      return {
        userMessage: message,
        assistantResponse,
        toolCallRecords,
        timestamp: message.timestamp,
      };
    }

    if (message.role === "assistant") {
      const userMessage = await prisma.message.findFirst({
        where: {
          conversationId: message.conversationId,
          role: "user",
          timestamp: {
            lte: message.timestamp,
          },
        },
        orderBy: { timestamp: "desc" },
        include: {
          toolCalls: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!userMessage) return null;

      const toolCallRecords = [
        ...(userMessage.toolCalls || []),
        ...(message.toolCalls || []),
      ];

      return {
        userMessage,
        assistantResponse: message,
        toolCallRecords,
        timestamp: userMessage.timestamp,
      };
    }

    return null;
  }

  // Search across all conversations via pgvector semantic similarity
  async findAcrossConversations(
    dateExpression?: string,
    topic?: string,
    dateResolver?: DateResolver,
    excludeMessageId?: string
  ): Promise<Array<HistoryMatch & { conversationId: string }>> {
    let startOfDay: Date | undefined;
    let endOfDay: Date | undefined;

    if (dateExpression && dateResolver) {
      const resolution = dateResolver.resolve(dateExpression);
      if (resolution) {
        const year = resolution.resolvedDate.getUTCFullYear();
        const month = resolution.resolvedDate.getUTCMonth();
        const day = resolution.resolvedDate.getUTCDate();
        startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
      }
    }

    if (topic && topic.trim()) {
      const matches = await this.findBySemanticSimilarity(topic, {
        startDate: startOfDay,
        endDate: endOfDay,
        excludeMessageId,
        limit: 10,
        matchType: startOfDay ? "combined" : "topic",
      });

      return matches.map((m) => ({
        ...m,
        conversationId: m.conversationId || m.message.conversationId,
      }));
    }

    // If only date expression without topic, query by date bounds across conversations
    const userMessages = await prisma.message.findMany({
      where: {
        role: "user",
        id: excludeMessageId ? { not: excludeMessageId } : undefined,
        timestamp: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: { timestamp: "desc" },
      take: 10,
      include: {
        toolCalls: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const results: Array<HistoryMatch & { conversationId: string }> = [];
    for (const userMsg of userMessages) {
      const assistantResponse = await prisma.message.findFirst({
        where: {
          conversationId: userMsg.conversationId,
          role: "assistant",
          timestamp: {
            gte: userMsg.timestamp,
          },
        },
        orderBy: { timestamp: "asc" },
        include: {
          toolCalls: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      results.push({
        message: userMsg,
        assistantResponse,
        matchType: "exact_date",
        matchConfidence: 0.9,
        conversationId: userMsg.conversationId,
      });
    }

    return results;
  }

  // Unified semantic memory retrieval for cross-conversation recall and past context grounding
  async retrieveContextForQuery(params: MemoryRetrievalParams): Promise<MemoryRetrievalResult> {
    const { userMessage, conversationId, currentUserMessageId, dateResolver } = params;
    const isExplicitRecall = ambiguityHandler.isExplicitRecallQuery(userMessage);
    const reference = ambiguityHandler.detectReference(userMessage, dateResolver);

    let matches: HistoryMatch[] = [];
    let isReverify = false;

    // Check if user is asking for re-verification ("is that still true", etc.)
    if (
      reference?.type === "implicit_followup" ||
      /\b(still\s+correct|accurate|changed|current|update|valid)\b/i.test(userMessage)
    ) {
      isReverify = true;
    }

    // 1. Explicit date and topic reference
    if (reference?.type === "date_and_topic") {
      matches = await this.findByDateAndTopic(
        conversationId || "",
        reference.dateExpression,
        reference.topic,
        dateResolver,
        currentUserMessageId
      );
      if (matches.length === 0) {
        matches = await this.findAcrossConversations(
          reference.dateExpression,
          reference.topic,
          dateResolver,
          currentUserMessageId
        );
      }
    } else if (reference?.type === "date_only") {
      matches = await this.findByDate(
        conversationId || "",
        reference.dateExpression,
        dateResolver,
        currentUserMessageId
      );
      if (matches.length === 0) {
        matches = await this.findAcrossConversations(
          reference.dateExpression,
          undefined,
          dateResolver,
          currentUserMessageId
        );
      }

      // If multiple distinct queries were asked on that date, offer disambiguation
      if (matches.length > 1) {
        return {
          matches,
          isExplicitRecall: true,
          recalledHistoryPrompt: "",
          ambiguousChoices: matches,
          isReverify,
        };
      }
    } else {
      // Check if user is asking a question or attempting to recall past discussions
      const isQuestion = /\?|^(who|what|where|when|why|how|which|can|could|should|would|is|are|do|does|did|will)\b/i.test(
        userMessage.trim()
      );

      // If user is just declaring a new preference/statement without asking a question or referencing past chats:
      // Do NOT inject past unrelated memories!
      if (!isExplicitRecall && !reference && !isQuestion) {
        return {
          matches: [],
          isExplicitRecall: false,
          recalledHistoryPrompt: "",
          isReverify,
        };
      }

      // If within current conversation, only search topic if explicit reference was made
      // (the current conversation's regular history is already in priorHistory)
      if (conversationId && reference?.type === "topic_only") {
        matches = await this.findByTopic(conversationId, reference.topic, currentUserMessageId);
        matches = matches.filter(
          (m) =>
            m.message.content &&
            m.message.content.trim().toLowerCase() !== userMessage.trim().toLowerCase() &&
            (!isExplicitRecall || !ambiguityHandler.isExplicitRecallQuery(m.message.content))
        );
      }

      // If no match in current conversation or if searching across conversations:
      if (matches.length === 0) {
        // Use a strict threshold (0.65) for general questions to prevent unrelated topic bleed
        const threshold = isExplicitRecall ? 0.48 : (env.VECTOR_SEARCH_THRESHOLD ?? 0.65);
        const searchTopic = reference?.type === "topic_only" ? reference.topic : userMessage;
        const raw = await this.findBySemanticSimilarity(searchTopic, {
          excludeMessageId: currentUserMessageId,
          threshold,
          limit: 8,
        });

        // Filter out echoes of the recall question itself to isolate actual past statements/preferences
        matches = raw.filter(
          (m) =>
            m.message.content &&
            m.message.content.trim().toLowerCase() !== userMessage.trim().toLowerCase() &&
            (!isExplicitRecall || !ambiguityHandler.isExplicitRecallQuery(m.message.content))
        );
      }
    }

    // 3. If no matches were found:
    if (matches.length === 0) {
      return {
        matches: [],
        isExplicitRecall,
        recalledHistoryPrompt: "",
        isReverify,
      };
    }

    // 4. Hydrate top exchanges and build rich context block for LLM
    const topMatches = matches.slice(0, 2);
    const exchanges = await Promise.all(
      topMatches.map((m) => this.getFullExchange(m.message.id))
    );
    const validExchanges = exchanges.filter((e): e is Exchange => !!e);

    let promptBlock = "";
    if (validExchanges.length > 0) {
      const exchangeDescriptions = validExchanges
        .map((ex, idx) => {
          const dateStr = dateResolver.formatForDisplay(ex.timestamp);
          return [
            `[Past Discussion ${idx + 1} - ${dateStr}]`,
            `- User previously stated/asked: "${ex.userMessage.content}"`,
            `- Assistant previously responded: "${ex.assistantResponse.content ? ex.assistantResponse.content.slice(0, 350) : ""}"`,
          ].join("\n");
        })
        .join("\n\n");

      promptBlock = [
        "### Recalled Background Context (from Vector Memory)",
        "The following background exchange was retrieved from your conversation history with this user:",
        exchangeDescriptions,
        "",
        "**Context Usage Directives:**",
        "- Use the background context above ONLY if it is directly relevant to answering the user's current request.",
        "- If the user's message is about a new or different topic, answer their prompt directly and DO NOT mention or bridge to unrelated past topics.",
        "- NEVER use phrases like 'Quick tie-back to what we discussed', 'Noted for future reference', or 'I have saved this to memory'.",
        "- If the user asks what they previously said or mentioned, summarize it clearly and conversationally.",
      ].join("\n");
    }

    return {
      matches,
      isExplicitRecall,
      recalledHistoryPrompt: promptBlock,
      isReverify,
    };
  }
}

export const historyRetriever = new HistoryRetriever();
