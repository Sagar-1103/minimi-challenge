import { env } from "./env";
import type { LLMProviderConfig } from "../types/llm.types";

export function getActiveLLMConfig(): LLMProviderConfig {
  if (env.LLM_PROVIDER === "deepseek") {
    return {
      provider: "deepseek",
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: env.DEEPSEEK_BASE_URL,
      model: env.DEEPSEEK_MODEL,
    };
  }

  return {
    provider: "openrouter",
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: env.OPENROUTER_BASE_URL,
    model: env.OPENROUTER_MODEL,
  };
}
