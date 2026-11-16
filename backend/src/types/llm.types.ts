export type LLMProvider = "openrouter";

export interface LLMProviderConfig {
  provider: LLMProvider;
  apiKey: string;
  baseURL: string;
  model: string;
}
