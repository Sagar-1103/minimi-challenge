import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AmbiguityHandler } from "../src/services/memory/ambiguity-handler";
import { DateResolver } from "../src/services/date-resolver";
import { buildSystemPrompt } from "../src/prompts/system";

describe("Semantic Vector Memory & Conversational Precision", () => {
  const ambiguityHandler = new AmbiguityHandler();
  const dateResolver = new DateResolver(new Date("2026-11-12T12:00:00Z"));

  describe("Explicit Recall & Topic Detection", () => {
    it("should identify conversational recall queries with zero date keywords", () => {
      const queries = [
        "What cold weather vacation destinations did I mention wanting to visit?",
        "What did I say about my favorite programming language?",
        "Where was I planning to go next winter?",
        "Remind me what thermal baths I was interested in",
        "Do you remember my stack preferences?",
      ];

      for (const q of queries) {
        assert.equal(
          ambiguityHandler.isExplicitRecallQuery(q),
          true,
          `Expected query to be identified as explicit recall: "${q}"`
        );
      }
    });

    it("should recognize standalone declarations as NOT explicit recall queries", () => {
      const declarations = [
        "My favorite programming language is Python and I work primarily on backend microservices.",
        "I am looking for a new job in distributed systems.",
        "Hello, how are you today?",
        "Let's look into Docker compose setups.",
      ];

      for (const d of declarations) {
        assert.equal(
          ambiguityHandler.isExplicitRecallQuery(d),
          false,
          `Expected declaration to NOT be explicit recall: "${d}"`
        );
      }
    });
  });

  describe("Conversational Tone & System Prompt Guardrails", () => {
    it("should include strict prohibitions against robotic memory meta-talk in system prompt", () => {
      const systemPrompt = buildSystemPrompt({
        referenceDate: new Date("2026-11-12T12:00:00Z"),
      });

      // Verify that robotic announcements are strictly forbidden
      assert.match(systemPrompt, /NEVER announce or narrate your memory operations/i);
      assert.match(systemPrompt, /Noted for future reference/i);
      assert.match(systemPrompt, /Quick tie-back to what we've been discussing/i);
      assert.match(systemPrompt, /without treating it like a database/i);
    });

    it("should instruct the agent to synthesize user statements naturally without disclaimers", () => {
      const systemPrompt = buildSystemPrompt({
        referenceDate: new Date("2026-11-12T12:00:00Z"),
      });

      assert.match(systemPrompt, /confirm what they DID mention/i);
      assert.match(systemPrompt, /rather than giving a negative disclaimer/i);
      assert.match(systemPrompt, /Never state that you lack access to previous conversations/i);
    });
  });
});
