import type {
  Conversation,
  Message,
  ToolCallRecord,
  MessageRole,
  ToolCallStatus,
} from "../generated/prisma/client";

export type {
  Conversation,
  Message,
  ToolCallRecord,
  MessageRole,
  ToolCallStatus,
};

export interface ToolCallRecordInput {
  toolName: string;
  query: string;
  result?: string;
  status?: ToolCallStatus;
  duration?: number;
}

export type MessageWithToolCalls = Message & {
  toolCalls?: ToolCallRecord[];
};

export type ConversationWithMessages = Conversation & {
  messages: MessageWithToolCalls[];
};

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  lastMessageAt?: Date;
}

export interface PaginatedConversations {
  conversations: ConversationSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
