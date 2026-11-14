import { tavily } from "@tavily/core";
import { env } from "../config/env";
import { SearchError } from "../middlewares/errorHandler";
import { logger } from "../utils/logger";

export interface TavilySearchOptions {
  query: string;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  includeAnswer?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeoutMs?: number;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
}

let tavilyClient: ReturnType<typeof tavily> | null = null;

function getClient(): ReturnType<typeof tavily> {
  if (!tavilyClient) {
    tavilyClient = tavily({ apiKey: env.TAVILY_API_KEY });
  }
  return tavilyClient;
}

export async function searchWeb(
  options: TavilySearchOptions
): Promise<TavilySearchResponse> {
  const {
    query,
    maxResults = 5,
    searchDepth = "basic",
    includeAnswer = true,
    includeDomains,
    excludeDomains,
    timeoutMs = 10000,
  } = options;

  if (!query || query.trim() === "") {
    throw new SearchError("Search query cannot be empty");
  }

  const client = getClient();

  const searchPromise = (async () => {
    try {
      const response = await client.search(query.trim(), {
        maxResults,
        searchDepth,
        includeAnswer,
        includeDomains: includeDomains?.length ? includeDomains : undefined,
        excludeDomains: excludeDomains?.length ? excludeDomains : undefined,
      });

      const results: TavilySearchResult[] = (response.results || []).map(
        (item: any) => ({
          title: item.title ?? "",
          url: item.url ?? "",
          content: item.content ?? "",
          score: typeof item.score === "number" ? item.score : 0,
          publishedDate: item.publishedDate ?? undefined,
        })
      );

      return {
        query: response.query || query,
        answer: response.answer ?? undefined,
        results,
      };
    } catch (err: any) {
      logger.error(`Tavily search API error for query "${query}": ${err.message}`, err);
      throw new SearchError(`Web search failed: ${err.message}`, { query, originalError: err });
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new SearchError(`Web search timed out after ${timeoutMs}ms`, { query }));
    }, timeoutMs);
  });

  return Promise.race([searchPromise, timeoutPromise]);
}
