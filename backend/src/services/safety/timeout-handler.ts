import { logger } from "../../utils/logger";

export interface TimeoutConfig {
  llmCallTimeoutMs?: number;
  searchTimeoutMs?: number;
  totalAgentTimeoutMs?: number;
}

export class TimeoutHandler {
  private llmCallTimeoutMs: number;
  private searchTimeoutMs: number;
  private totalAgentTimeoutMs: number;

  constructor(config: TimeoutConfig = {}) {
    this.llmCallTimeoutMs = config.llmCallTimeoutMs ?? 30000;
    this.searchTimeoutMs = config.searchTimeoutMs ?? 10000;
    this.totalAgentTimeoutMs = config.totalAgentTimeoutMs ?? 120000;
  }

  getLLMTimeout(): number {
    return this.llmCallTimeoutMs;
  }

  getSearchTimeout(): number {
    return this.searchTimeoutMs;
  }

  getTotalTimeout(): number {
    return this.totalAgentTimeoutMs;
  }

  // Execute an asynchronous operation with an upper time bound and graceful fallback
  async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    fallback: T,
    label = "Operation"
  ): Promise<{ result: T; timedOut: boolean }> {
    let timeoutId: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<{ result: T; timedOut: true }>((resolve) => {
      timeoutId = setTimeout(() => {
        logger.warn(`${label} timed out after ${timeoutMs}ms. Using fallback.`);
        resolve({ result: fallback, timedOut: true });
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        promise.then((res) => ({ result: res, timedOut: false as const })),
        timeoutPromise,
      ]);

      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      logger.error(`${label} rejected with error: ${err.message}`);
      return { result: fallback, timedOut: false };
    }
  }

  // Create an AbortController with automatic timeout cancellation
  createAbortController(timeoutMs: number): AbortController {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Unref timer so it doesn't hold the process open
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    return controller;
  }

  // Check if overall runtime has elapsed
  isExpired(startTime: number, maxMs?: number): boolean {
    const limit = maxMs ?? this.totalAgentTimeoutMs;
    return Date.now() - startTime >= limit;
  }

  // Remaining runtime budget
  getRemainingMs(startTime: number, maxMs?: number): number {
    const limit = maxMs ?? this.totalAgentTimeoutMs;
    return Math.max(0, limit - (Date.now() - startTime));
  }
}

export const timeoutHandler = new TimeoutHandler();
