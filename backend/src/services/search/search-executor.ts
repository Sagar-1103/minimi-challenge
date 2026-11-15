import { searchWeb, type TavilySearchResponse, type TavilySearchResult } from "../../lib/tavily";
import { SearchDedup, searchDedup } from "./dedup";
import { ResultProcessor, resultProcessor, type ProcessedSearchResult } from "./result-processor";
import { logger } from "../../utils/logger";

export interface SearchExecutorConfig {
  maxConcurrency?: number;
  timeoutMs?: number;
  maxTotalSearches?: number;
  ttlSeconds?: number;
}

export interface SingleExecutionResult {
  query: string;
  results: ProcessedSearchResult[];
  formatted: string;
  cached: boolean;
  duration: number;
  rawResults: TavilySearchResult[];
}

export class SearchExecutor {
  private maxConcurrency: number;
  private timeoutMs: number;
  private maxTotalSearches: number;
  private searchCount = 0;

  constructor(
    config: SearchExecutorConfig = {},
    private dedup: SearchDedup = searchDedup,
    private processor: ResultProcessor = resultProcessor
  ) {
    this.maxConcurrency = config.maxConcurrency ?? 5;
    this.timeoutMs = config.timeoutMs ?? 12000;
    this.maxTotalSearches = config.maxTotalSearches ?? 20;
  }

  public getSearchCount(): number {
    return this.searchCount;
  }

  public isAtBudget(): boolean {
    return this.searchCount >= this.maxTotalSearches;
  }

  // Executes a single search with cache check, timeout, and result processing
  public async executeSingle(
    query: string,
    entity?: string,
    anchorDate?: Date
  ): Promise<SingleExecutionResult> {
    const startTime = Date.now();

    // 1. Check cache first
    const cachedResponse = await this.dedup.checkCache(query);
    if (cachedResponse) {
      const processed = this.processor.process(cachedResponse.results, {
        anchorDate,
        entity,
        query,
      });

      return {
        query,
        results: processed,
        formatted: this.processor.formatForLLM(processed),
        cached: true,
        duration: Date.now() - startTime,
        rawResults: cachedResponse.results,
      };
    }

    // 2. Budget check
    if (this.isAtBudget()) {
      logger.warn(`Search budget of ${this.maxTotalSearches} reached. Skipping query: "${query}"`);
      return {
        query,
        results: [],
        formatted: "Search skipped: per-run search budget exceeded.",
        cached: false,
        duration: Date.now() - startTime,
        rawResults: [],
      };
    }

    // 3. Execute with timeout
    this.searchCount++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const rawResponse: TavilySearchResponse = await searchWeb({ query });
      clearTimeout(timeoutId);

      // Cache raw response for subsequent turns or deduplication
      await this.dedup.record(query, rawResponse);

      const processed = this.processor.process(rawResponse.results, {
        anchorDate,
        entity,
        query,
      });

      return {
        query,
        results: processed,
        formatted: this.processor.formatForLLM(processed),
        cached: false,
        duration: Date.now() - startTime,
        rawResults: rawResponse.results,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      logger.error(`Search error for "${query}": ${err.message}`);
      return {
        query,
        results: [],
        formatted: `Search failed for query "${query}": ${err.message}`,
        cached: false,
        duration: Date.now() - startTime,
        rawResults: [],
      };
    }
  }

  // Executes a pool of queries in parallel respecting maxConcurrency limits
  public async executeParallel(
    queries: Array<{ id: string; query: string; entity?: string }>,
    anchorDate?: Date
  ): Promise<Map<string, SingleExecutionResult>> {
    const resultsMap = new Map<string, SingleExecutionResult>();
    if (queries.length === 0) return resultsMap;

    // Concurrency pool runner
    const queue = [...queries];
    const inFlight: Promise<void>[] = [];

    const runWorker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        const res = await this.executeSingle(item.query, item.entity, anchorDate);
        resultsMap.set(item.id, res);
      }
    };

    const workerCount = Math.min(this.maxConcurrency, queries.length);
    for (let i = 0; i < workerCount; i++) {
      inFlight.push(runWorker());
    }

    await Promise.allSettled(inFlight);
    return resultsMap;
  }
}
