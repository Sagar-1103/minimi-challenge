import { prisma } from "../../lib/prisma";
import type {
  MessageWithToolCalls,
  ToolCallRecord,
} from "../../types/conversation.types";
import { DateResolver } from "../date-resolver";

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

export class HistoryRetriever {
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

  // Find messages containing specific topic keywords
  async findByTopic(
    conversationId: string,
    topic: string,
    excludeMessageId?: string
  ): Promise<HistoryMatch[]> {
    const cleanTopic = topic.trim();
    if (!cleanTopic) return [];

    const userMessages = await prisma.message.findMany({
      where: {
        conversationId,
        role: "user",
        id: excludeMessageId ? { not: excludeMessageId } : undefined,
        content: {
          contains: cleanTopic,
          mode: "insensitive",
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
        matchType: "topic",
        matchConfidence: 0.8,
        conversationId,
      });
    }

    return matches;
  }

  // Find messages matching both a date constraint and topic keyword
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

    const userMessages = await prisma.message.findMany({
      where: {
        conversationId,
        role: "user",
        id: excludeMessageId ? { not: excludeMessageId } : undefined,
        timestamp: {
          gte: startOfDay,
          lte: endOfDay,
        },
        content: {
          contains: topic.trim(),
          mode: "insensitive",
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
        matchType: "combined",
        matchConfidence: 0.95,
        conversationId,
      });
    }

    return matches;
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

  // Search across all conversations when a referenced turn is not in the current session
  async findAcrossConversations(
    dateExpression?: string,
    topic?: string,
    dateResolver?: DateResolver,
    excludeMessageId?: string
  ): Promise<Array<HistoryMatch & { conversationId: string }>> {
    let startOfDay: Date | undefined;
    let endOfDay: Date | undefined;
    let resolutionConfidence = 0.8;

    if (dateExpression && dateResolver) {
      const resolution = dateResolver.resolve(dateExpression);
      if (resolution) {
        const year = resolution.resolvedDate.getUTCFullYear();
        const month = resolution.resolvedDate.getUTCMonth();
        const day = resolution.resolvedDate.getUTCDate();
        startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
        resolutionConfidence = resolution.confidence === "exact" ? 0.95 : 0.85;
      }
    }

    const whereClause: any = {
      role: "user",
    };

    if (excludeMessageId) {
      whereClause.id = { not: excludeMessageId };
    }

    if (startOfDay && endOfDay) {
      whereClause.timestamp = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    if (topic && topic.trim()) {
      whereClause.content = {
        contains: topic.trim(),
        mode: "insensitive",
      };
    }

    const userMessages = await prisma.message.findMany({
      where: whereClause,
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

      const matchType =
        startOfDay && topic
          ? "combined"
          : startOfDay
          ? "exact_date"
          : "topic";

      results.push({
        message: userMsg,
        assistantResponse,
        matchType,
        matchConfidence: resolutionConfidence,
        conversationId: userMsg.conversationId,
      });
    }

    return results;
  }
}

export const historyRetriever = new HistoryRetriever();
