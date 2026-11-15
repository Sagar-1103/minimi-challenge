import type { ToolCall } from "../../types/agent.types";

export interface LoopBreakerConfig {
  maxIterations?: number;
  maxToolCalls?: number;
  maxTokenBudget?: number;
  maxDuplicateQueries?: number;
  forceAnswerAtIteration?: number;
}

export class LoopBreaker {
  private iterations = 0;
  private toolCalls = 0;
  private tokenCount = 0;
  private queryCounts = new Map<string, number>();

  private maxIterations: number;
  private maxToolCalls: number;
  private maxTokenBudget: number;
  private maxDuplicateQueries: number;
  private forceAnswerAtIteration: number;

  constructor(config: LoopBreakerConfig = {}) {
    this.maxIterations = config.maxIterations ?? 12;
    this.maxToolCalls = config.maxToolCalls ?? 20;
    this.maxTokenBudget = config.maxTokenBudget ?? 32000;
    this.maxDuplicateQueries = config.maxDuplicateQueries ?? 2;
    this.forceAnswerAtIteration =
      config.forceAnswerAtIteration ?? Math.max(1, this.maxIterations - 1);
  }

  getIterationCount(): number {
    return this.iterations;
  }

  getToolCallCount(): number {
    return this.toolCalls;
  }

  // Canonical representation of a query for duplicate detection
  normalizeQuery(query: string): string {
    if (!query) return "";
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .trim()
      .split(/\s+/)
      .sort()
      .join(" ");
  }

  // Check whether this query has already reached the maximum retry limit
  isDuplicateQuery(query: string): boolean {
    const key = this.normalizeQuery(query);
    if (!key) return false;

    const count = this.queryCounts.get(key) || 0;
    return count >= this.maxDuplicateQueries;
  }

  // Record an iteration step
  recordIteration(): void {
    this.iterations++;
  }

  // Record tool calls and register queries
  recordToolCalls(calls: ToolCall[]): void {
    this.toolCalls += calls.length;

    for (const call of calls) {
      const q = typeof call.arguments?.query === "string" ? call.arguments.query : "";
      if (q) {
        const key = this.normalizeQuery(q);
        const count = this.queryCounts.get(key) || 0;
        this.queryCounts.set(key, count + 1);
      }
    }
  }

  // Track token expenditure
  recordTokens(tokens: number): void {
    this.tokenCount += tokens;
  }

  // Determine whether the agent loop can proceed or must force a conclusion
  shouldContinue(): { continue: boolean; reason?: string } {
    if (this.iterations >= this.maxIterations) {
      return {
        continue: false,
        reason: `Hard cap on loop iterations (${this.maxIterations}) reached.`,
      };
    }

    if (this.toolCalls >= this.maxToolCalls) {
      return {
        continue: false,
        reason: `Maximum tool call budget (${this.maxToolCalls}) exceeded.`,
      };
    }

    if (this.tokenCount >= this.maxTokenBudget) {
      return {
        continue: false,
        reason: `Token expenditure limit (${this.maxTokenBudget}) reached.`,
      };
    }

    return { continue: true };
  }

  // Should we instruct the model to produce its final answer on this turn?
  isAtForceAnswerThreshold(): boolean {
    return this.iterations >= this.forceAnswerAtIteration;
  }

  // Directive injected when forcing the model to wrap up
  getForceAnswerMessage(): string {
    return "You have used all available search steps. Provide your best answer now based on what you've found so far. If you couldn't find information about something, explicitly say so. Do not perform any more searches.";
  }
}
