import { prisma } from "../lib/prisma";
import { embeddingService } from "./embedding.service";
import { logger } from "../utils/logger";
import type {
  Message,
  MessageWithToolCalls,
  ToolCallRecordInput,
} from "../types/conversation.types";

export class MessageService {
  // Asynchronously generate and attach pgvector embedding to a message
  public embedMessageBackground(messageId: string, content: string): void {
    if (!content || !content.trim()) return;

    // Fire-and-forget: does not block message creation or streaming
    embeddingService
      .getEmbedding(content)
      .then(async (vector) => {
        if (!vector || vector.length === 0 || vector.every((v) => v === 0)) return;
        const vectorStr = `[${vector.join(",")}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE messages SET embedding = $1::vector WHERE id = $2;`,
          vectorStr,
          messageId
        );
      })
      .catch((err) => {
        logger.warn(`Background message embedding failed for ${messageId}: ${err.message}`);
      });
  }

  async addUserMessage(
    conversationId: string,
    content: string,
    timestamp?: Date
  ): Promise<Message> {
    const msg = await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content,
        timestamp: timestamp ?? new Date(),
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Generate pgvector embedding in background
    this.embedMessageBackground(msg.id, content);

    return msg;
  }

  async addAssistantMessage(
    conversationId: string,
    content: string,
    toolCalls?: ToolCallRecordInput[],
    model?: string,
    timestamp?: Date
  ): Promise<MessageWithToolCalls> {
    const created = await prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content,
        model,
        timestamp: timestamp ?? new Date(),
        toolCalls:
          toolCalls && toolCalls.length > 0
            ? {
                create: toolCalls.map((tc) => ({
                  toolName: tc.toolName,
                  query: tc.query,
                  result: tc.result,
                  status: tc.status ?? "SUCCESS",
                  duration: tc.duration,
                })),
              }
            : undefined,
      },
      include: {
        toolCalls: true,
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Generate pgvector embedding in background
    this.embedMessageBackground(created.id, content);

    return created;
  }

  async addToolMessage(
    conversationId: string,
    toolCallId: string,
    _toolName: string,
    result: string,
    timestamp?: Date
  ): Promise<Message> {
    return prisma.message.create({
      data: {
        conversationId,
        role: "tool",
        toolCallId,
        content: result,
        timestamp: timestamp ?? new Date(),
      },
    });
  }

  async getHistory(conversationId: string): Promise<MessageWithToolCalls[]> {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: "asc" },
      include: {
        toolCalls: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  async getByDateRange(
    conversationId: string,
    start: Date,
    end: Date
  ): Promise<Message[]> {
    return prisma.message.findMany({
      where: {
        conversationId,
        timestamp: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { timestamp: "asc" },
    });
  }

  async saveToolCalls(
    messageId: string,
    toolCalls: ToolCallRecordInput[]
  ): Promise<void> {
    if (!toolCalls || toolCalls.length === 0) return;

    await prisma.toolCallRecord.createMany({
      data: toolCalls.map((tc) => ({
        messageId,
        toolName: tc.toolName,
        query: tc.query,
        result: tc.result,
        status: tc.status ?? "SUCCESS",
        duration: tc.duration,
      })),
    });
  }
}

export const messageService = new MessageService();
