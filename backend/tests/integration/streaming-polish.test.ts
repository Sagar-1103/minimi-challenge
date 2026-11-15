import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentEventEmitter } from "../../src/services/agent-emitter";
import { ContextOptimizer } from "../../src/services/context-optimizer";
import { ResponseFormatter } from "../../src/services/answer/response-formatter";
import type { ProcessedSearchResult } from "../../src/services/search/result-processor";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

describe("Streaming, Performance & Polish Integration Tests", () => {
  describe("AgentEventEmitter Event Dispatching", () => {
    it("should emit and handle status, tool, chunk, and done events", () => {
      const emitter = new AgentEventEmitter();
      const eventsReceived: Array<{ type: string; payload: any }> = [];

      emitter.on("status", (data) => eventsReceived.push({ type: "status", payload: data }));
      emitter.on("tool_start", (data) => eventsReceived.push({ type: "tool_start", payload: data }));
      emitter.on("tool_end", (data) => eventsReceived.push({ type: "tool_end", payload: data }));
      emitter.on("answer_chunk", (data) => eventsReceived.push({ type: "answer_chunk", payload: data }));
      emitter.on("done", (data) => eventsReceived.push({ type: "done", payload: data }));

      emitter.emitStatus("Searching web...");
      emitter.emitToolStart("web_search", "Postgres pricing 2026", 0);
      emitter.emitToolEnd("web_search", "Postgres pricing 2026", 3, 450);
      emitter.emitAnswerChunk("Neon is $0/mo.");
      emitter.emitDone("conv_123", "msg_456");

      assert.equal(eventsReceived.length, 5);
      assert.equal(eventsReceived[0].type, "status");
      assert.equal(eventsReceived[0].payload.message, "Searching web...");

      assert.equal(eventsReceived[1].type, "tool_start");
      assert.equal(eventsReceived[1].payload.query, "Postgres pricing 2026");

      assert.equal(eventsReceived[2].type, "tool_end");
      assert.equal(eventsReceived[2].payload.resultCount, 3);

      assert.equal(eventsReceived[3].type, "answer_chunk");
      assert.equal(eventsReceived[3].payload.chunk, "Neon is $0/mo.");

      assert.equal(eventsReceived[4].type, "done");
      assert.equal(eventsReceived[4].payload.conversationId, "conv_123");
    });
  });

  describe("ContextOptimizer Token & History Bounds", () => {
    const optimizer = new ContextOptimizer();

    it("should estimate token count using character heuristic", () => {
      const text = "1234567890123456"; // 16 characters
      const tokens = optimizer.estimateTokens(text);
      assert.equal(tokens, 4);
    });

    it("should truncate verbose search results when exceeding maxTokens", () => {
      const verboseResults: ProcessedSearchResult[] = [
        {
          title: "Doc 1",
          url: "https://example.com/1",
          domain: "example.com",
          content: "A".repeat(400), // ~100 tokens
          score: 0.9,
          qualityScore: 0.9,
          isAfterAnchor: false,
          isPrimarySource: true,
        },
        {
          title: "Doc 2",
          url: "https://example.com/2",
          domain: "example.com",
          content: "B".repeat(600), // ~150 tokens
          score: 0.8,
          qualityScore: 0.8,
          isAfterAnchor: false,
          isPrimarySource: true,
        },
      ];

      // Limit to 120 tokens: should keep first doc and truncate second doc
      const truncated = optimizer.truncateSearchResults(verboseResults, 160);
      assert.ok(truncated.length >= 1);
      assert.ok(truncated[0].content.length <= 400);
      if (truncated.length > 1) {
        assert.ok(truncated[1].content.endsWith("..."));
      }
    });

    it("should extract key sentences within token limits", () => {
      const content =
        "Neon provides serverless Postgres. The free tier includes 0.5 GB storage. It scales compute down to zero automatically. Support is available on Discord.";
      const facts = optimizer.extractKeyFacts(content, 20); // ~80 chars

      assert.match(facts, /Neon provides serverless Postgres/);
      assert.ok(facts.length <= 100);
    });

    it("should preserve system message and prune older turns when exceeding history budget", () => {
      const history: ChatCompletionMessageParam[] = [
        { role: "system", content: "You are an AI assistant." },
        { role: "user", content: "Message 1 ".repeat(20) },
        { role: "assistant", content: "Response 1 ".repeat(20) },
        { role: "user", content: "Recent question" },
        { role: "assistant", content: "Recent answer" },
      ];

      const optimized = optimizer.optimizeHistory(history, 60);

      assert.equal(optimized[0].role, "system");
      assert.equal(optimized[optimized.length - 1].content, "Recent answer");
      assert.ok(optimized.length < history.length);
    });
  });

  describe("ResponseFormatter Markdown & Metadata Polish", () => {
    const formatter = new ResponseFormatter();

    it("should automatically close unclosed markdown code blocks", () => {
      const unclosed = "Here is the code:\n```typescript\nconst x = 10;";
      const cleaned = formatter.cleanMarkdown(unclosed);

      assert.ok(cleaned.endsWith("\n```"));
      assert.equal((cleaned.match(/```/g) || []).length, 2);
    });

    it("should clean up broken empty citation link labels", () => {
      const text = "See [](https://neon.tech/pricing) for details.";
      const cleaned = formatter.cleanCitations(text, []);

      assert.match(cleaned, /\[neon\.tech\]\(https:\/\/neon\.tech\/pricing\)/);
      assert.doesNotMatch(cleaned, /\[\s*\]/);
    });

    it("should append subtle verification metadata when sources were evaluated", () => {
      const text = "Neon costs $0/month for 0.5 GB.";
      const withMeta = formatter.addMetadata(text, {
        sourcesChecked: 4,
        durationMs: 1200,
      });

      assert.match(withMeta, /\*Evaluated across 4 web sources in 1\.2s\*/);
    });

    it("should normalize multiple consecutive blank lines", () => {
      const messy = "Header\n\n\n\n\nParagraph text";
      const cleaned = formatter.cleanMarkdown(messy);

      assert.equal(cleaned, "Header\n\nParagraph text");
    });
  });
});
