import OpenAI from "openai";
import { getActiveLLMConfig } from "../config/llm";

const initialConfig = getActiveLLMConfig();

export const llm = new OpenAI({
  apiKey: initialConfig.apiKey,
  baseURL: initialConfig.baseURL,
});

export function getActiveModel(): string {
  return getActiveLLMConfig().model;
}

export function getLLMClient(): OpenAI {
  const config = getActiveLLMConfig();
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}
