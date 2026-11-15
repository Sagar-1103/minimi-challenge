export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ToolCallItem {
  id?: string;
  name?: string;
  toolName?: string;
  query: string;
  resultCount?: number;
  durationMs?: number;
  duration?: number | null;
  status?: "running" | "SUCCESS" | "FAILED";
}

export interface Citation {
  index: number;
  url: string;
  domain: string;
  title: string;
  authoritative?: boolean;
  snippet?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  citations?: Citation[];
  toolCalls?: ToolCallItem[];
  statusText?: string;
  isStreaming?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface SystemHealth {
  status: "healthy" | "degraded";
  checks: {
    server: string;
    database: string;
    llm: string;
    tavily: string;
  };
  timestamp: string;
}
