import { prisma } from "../lib/prisma";
import { NotFoundError } from "../middlewares/errorHandler";
import type {
  Conversation,
  ConversationWithMessages,
  PaginatedConversations,
  ConversationSummary,
} from "../types/conversation.types";

function generateTitle(firstMessage?: string): string {
  if (!firstMessage || firstMessage.trim() === "") {
    return "New Conversation";
  }
  const clean = firstMessage.trim().replace(/\s+/g, " ");
  if (clean.length <= 50) return clean;
  return `${clean.slice(0, 47)}...`;
}

export class ConversationService {
  async create(firstMessage?: string): Promise<Conversation> {
    const title = generateTitle(firstMessage);
    return prisma.conversation.create({
      data: {
        title,
      },
    });
  }

  async getById(
    id: string,
    messageLimit?: number
  ): Promise<ConversationWithMessages | null> {
    if (!messageLimit) {
      return prisma.conversation.findUnique({
        where: { id },
        include: {
          messages: {
            orderBy: { timestamp: "asc" },
            include: {
              toolCalls: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      });
    }

    const conv = await prisma.conversation.findUnique({
      where: { id },
    });
    if (!conv) return null;

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { timestamp: "desc" },
      take: messageLimit,
      include: {
        toolCalls: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return {
      ...conv,
      messages: messages.reverse(),
    };
  }

  async list(page = 1, limit = 20): Promise<PaginatedConversations> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;

    const [total, conversations] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.findMany({
        skip,
        take: safeLimit,
        orderBy: { updatedAt: "desc" },
        include: {
          _count: {
            select: { messages: true },
          },
          messages: {
            orderBy: { timestamp: "desc" },
            take: 1,
            select: { timestamp: true },
          },
        },
      }),
    ]);

    const summaries: ConversationSummary[] = conversations.map((conv) => ({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messageCount: conv._count.messages,
      lastMessageAt: conv.messages[0]?.timestamp,
    }));

    return {
      conversations: summaries,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    };
  }

  async updateTitle(id: string, title: string): Promise<Conversation> {
    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError(`Conversation with ID "${id}" not found`);
    }

    return prisma.conversation.update({
      where: { id },
      data: { title: title.trim() },
    });
  }

  async delete(id: string): Promise<void> {
    const existing = await prisma.conversation.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundError(`Conversation with ID "${id}" not found`);
    }

    await prisma.conversation.delete({
      where: { id },
    });
  }
}

export const conversationService = new ConversationService();
