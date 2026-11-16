import { prisma } from "../../lib/prisma";
import { embeddingService } from "../embedding.service";
import { env } from "../../config/env";
import type {
  MessageWithToolCalls,
  ToolCallRecord,
} from "../../types/conversation.types";
import { DateResolver } from "../date-resolver";
import { logger } from "../../utils/logger";

export interface HistoryMatch {
  message: MessageWithToolCalls;
  assistantResponse: MessageWithToolCalls | null;
  matchType: "exact_date" | "date_range" | "topic" | "combined";
  matchConfidence: number;
  conversationId?: string;
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
}

export const historyRetriever = new HistoryRetriever();
