import { EventEmitter } from "events";
import type { Citation } from "./answer/citation-engine";

export class AgentEventEmitter extends EventEmitter {
  emitStatus(message: string): void {
    this.emit("status", { message });
  }

  emitToolStart(name: string, query: string, index: number): void {
    this.emit("tool_start", { name, query, index });
  }

  emitToolEnd(name: string, query: string, resultCount: number, durationMs: number): void {
    this.emit("tool_end", { name, query, resultCount, durationMs });
  }

  emitAnswerStart(): void {
    this.emit("answer_start");
  }

  emitAnswerChunk(chunk: string): void {
    this.emit("answer_chunk", { chunk });
  }

  emitAnswerEnd(fullAnswer: string): void {
    this.emit("answer_end", { fullAnswer });
  }

  emitSources(citations: Citation[]): void {
    this.emit("sources", { citations });
  }

  emitError(message: string, code?: string): void {
    this.emit("error", { message, code });
  }

  emitDone(conversationId: string | undefined, messageId: string): void {
    this.emit("done", { conversationId, messageId });
  }
}
