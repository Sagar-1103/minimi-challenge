import type { ProcessedSearchResult } from "../search/result-processor";

export type ErrorAction =
  | { action: "retry"; delay: number; modifiedQuery?: string }
  | { action: "skip"; reason: string }
  | { action: "fail"; message: string }
  | { action: "switch_provider" };

export class ErrorRecovery {
  // Calculate jittered exponential backoff delay
  getBackoffDelay(attempt: number, baseMs = 1000): number {
    const exp = Math.min(attempt, 5);
    const delay = baseMs * Math.pow(2, exp);
    const jitter = Math.random() * 500;
    return Math.min(delay + jitter, 30000);
  }

  // Handle empty search results by attempting query simplification
  handleEmptyResults(query: string, attempt: number): ErrorAction {
    if (attempt <= 1) {
      // Remove punctuation and trailing qualifiers to broaden the search
      const words = query
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2);

      // Take the first 3-4 most prominent words
      const simplified = words.slice(0, 4).join(" ");
      if (simplified && simplified.toLowerCase() !== query.toLowerCase()) {
        return {
          action: "retry",
          delay: 0,
          modifiedQuery: simplified,
        };
      }
    }

    return {
      action: "skip",
      reason: `Query "${query}" returned no results after simplification attempts.`,
    };
  }

  // Manage search API errors (distinguishing transient rate limits from terminal client errors)
  handleSearchError(error: Error, query: string, attempt: number): ErrorAction {
    const msg = error.message.toLowerCase();

    // Transient errors eligible for retry
    if (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("timeout") ||
      msg.includes("network") ||
      msg.includes("503")
    ) {
      if (attempt < 3) {
        return {
          action: "retry",
          delay: this.getBackoffDelay(attempt),
        };
      }
      return {
        action: "skip",
        reason: `Search API rate-limited or unavailable after ${attempt} attempts for "${query}".`,
      };
    }

    // Unrecoverable errors (invalid syntax, 400, 404)
    return {
      action: "skip",
      reason: `Search failed with unrecoverable error: ${error.message}`,
    };
  }

  // Manage LLM provider errors with backoff
  handleLLMError(error: Error, attempt: number): ErrorAction {
    if (attempt < 3) {
      return {
        action: "retry",
        delay: this.getBackoffDelay(attempt),
      };
    }

    return {
      action: "fail",
      message: `LLM API call failed after ${attempt} attempts: ${error.message}`,
    };
  }

  // Detect and report discrepancies between multiple retrieved sources
  handleConflict(results: ProcessedSearchResult[]): string {
    if (results.length < 2) return "";

    const prices: string[] = [];
    for (const r of results) {
      const match = r.content.match(/\$\d+(?:\.\d+)?/);
      if (match && !prices.includes(match[0])) {
        prices.push(`${match[0]} ([${r.domain}](${r.url}))`);
      }
    }

    if (prices.length >= 2) {
      return `Note: Conflicting pricing data was found across sources (${prices.join(" vs ")}). Official vendor documentation should be checked for confirmation.`;
    }

    return "";
  }

  // Check if a snippet appears truncated due to a paywall or login wall
  handlePaywall(url: string, content?: string): { isPaywalled: boolean; notice?: string } {
    const text = (content || "").toLowerCase();
    const isPaywalled =
      /\b(subscribe to read|paywall|subscriber-only|sign in to read the full story|membership required)\b/i.test(
        text
      ) ||
      /^(www\.)?(wsj\.com|ft\.com|bloomberg\.com|economist\.com)$/i.test(
        new URL(url).hostname.replace(/^www\./, "")
      );

    if (isPaywalled) {
      return {
        isPaywalled: true,
        notice: `Content from ${url} appears paywalled; relying on publicly available summaries.`,
      };
    }

    return { isPaywalled: false };
  }
}

export const errorRecovery = new ErrorRecovery();
