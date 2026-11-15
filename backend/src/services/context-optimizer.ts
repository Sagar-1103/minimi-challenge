import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ProcessedSearchResult } from "./search/result-processor";

export class ContextOptimizer {
  // Approximate tokens from text characters (roughly 4 characters per token)
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  // Bound search snippet volume within a token budget to preserve LLM context space
  truncateSearchResults(
    results: ProcessedSearchResult[],
    maxTokens = 2000
  ): ProcessedSearchResult[] {
    const optimized: ProcessedSearchResult[] = [];
    let currentTokens = 0;

    for (const r of results) {
      const tokens = this.estimateTokens(r.content);
      if (currentTokens + tokens <= maxTokens) {
        optimized.push(r);
        currentTokens += tokens;
      } else {
        const remainingTokens = maxTokens - currentTokens;
        if (remainingTokens > 50) {
          const allowedChars = remainingTokens * 4;
          optimized.push({
            ...r,
            content: `${r.content.slice(0, allowedChars)}...`,
          });
        }
        break;
      }
    }

    return optimized;
  }

  // Extract key sentences from verbose content to produce compact snippets
  extractKeyFacts(content: string, maxTokens = 150): string {
    if (!content) return "";
    const sentences = content.split(/(?<=[.?!])\s+/);
    const keySentences: string[] = [];
    let tokens = 0;

    for (const s of sentences) {
      const t = this.estimateTokens(s);
      if (tokens + t <= maxTokens) {
        keySentences.push(s);
        tokens += t;
      } else {
        break;
      }
    }

    return keySentences.join(" ");
  }

  // Prune older history turns to ensure the message payload respects context limits
  optimizeHistory(
    messages: ChatCompletionMessageParam[],
    maxTokens = 4000
  ): ChatCompletionMessageParam[] {
    if (messages.length <= 2) return messages;

    const system = messages[0]?.role === "system" ? messages[0] : null;
    const turns = system ? messages.slice(1) : messages;

    let totalTokens = system
      ? this.estimateTokens(typeof system.content === "string" ? system.content : "")
      : 0;
    const kept: ChatCompletionMessageParam[] = [];

    for (let i = turns.length - 1; i >= 0; i--) {
      const msg = turns[i];
      const text =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content || "");
      const t = this.estimateTokens(text) + 4;

      if (totalTokens + t <= maxTokens) {
        kept.unshift(msg);
        totalTokens += t;
      } else {
        break;
      }
    }

    return system ? [system, ...kept] : kept;
  }
}

export const contextOptimizer = new ContextOptimizer();
