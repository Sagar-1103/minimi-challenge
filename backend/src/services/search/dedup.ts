import type { TavilySearchResponse, TavilySearchResult } from "../../lib/tavily";
import { type CacheStore, InMemoryCacheStore } from "../cache/cache.interface";

// Shared in-memory cache instance (can be swapped with Redis)
export const globalSearchCache: CacheStore = new InMemoryCacheStore();

export class SearchDedup {
  constructor(private cache: CacheStore = globalSearchCache) {}

  // Canonicalize query: lowercase, strip punctuation, sort words
  public normalizeQuery(query: string): string {
    if (!query || typeof query !== "string") return "";

    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .sort()
      .join(" ");
  }

  // Look up cached search response
  public async checkCache(query: string): Promise<TavilySearchResponse | null> {
    const key = this.normalizeQuery(query);
    if (!key) return null;
    return this.cache.get<TavilySearchResponse>(key);
  }

  // Store search response in cache with default 15-minute TTL
  public async record(
    query: string,
    result: TavilySearchResponse,
    ttlSeconds = 900
  ): Promise<void> {
    const key = this.normalizeQuery(query);
    if (!key) return;
    await this.cache.set(key, result, ttlSeconds);
  }

  // Deduplicate search results by URL across queries
  public deduplicateResults(results: TavilySearchResult[]): TavilySearchResult[] {
    const seenUrls = new Set<string>();
    const deduplicated: TavilySearchResult[] = [];

    for (const item of results) {
      if (!item.url) continue;

      // Normalize URL (strip trailing slash and lowercase hostname)
      let normalizedUrl = item.url.trim();
      try {
        const u = new URL(normalizedUrl);
        normalizedUrl = `${u.origin}${u.pathname.replace(/\/$/, "")}${u.search}`;
      } catch {
        // Fallback to raw URL string
      }

      if (!seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        deduplicated.push(item);
      }
    }

    return deduplicated;
  }
}

export const searchDedup = new SearchDedup();
