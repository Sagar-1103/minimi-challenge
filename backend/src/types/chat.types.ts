import type { AgentStep } from "./agent.types";

export interface SourceCitation {
  title: string;
  url: string;
  domain: string;
  date?: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface ChatResponse {
  answer: string;
  conversationId?: string;
  messageId?: string;
  sources: SourceCitation[];
  steps: AgentStep[];
}
