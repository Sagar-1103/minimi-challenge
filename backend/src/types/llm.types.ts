export type LLMProvider = "deepseek" | "openrouter";

export interface LLMProviderConfig {
  provider: LLMProvider;
  apiKey: string;
  baseURL: string;
  model: string;
}
