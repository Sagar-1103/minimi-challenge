import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: string;
}

export interface AgentStep {
  index: number;
  type: "llm_call" | "tool_execution" | "final_answer";
  input?: any;
  output?: any;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp: string;
}

export interface AgentConfig {
  maxIterations: number;
  maxTokens?: number;
  temperature?: number;
  model: string;
}

export interface AgentContext {
  conversationHistory: ChatCompletionMessageParam[];
  systemPrompt: string;
  config: AgentConfig;
  steps: AgentStep[];
}
