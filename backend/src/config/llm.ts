import { env } from "./env";
import type { LLMProviderConfig } from "../types/llm.types";

export function getActiveLLMConfig(): LLMProviderConfig {
  return {
    provider: "openrouter",
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: env.OPENROUTER_BASE_URL,
    model: env.OPENROUTER_MODEL,
  };
}
