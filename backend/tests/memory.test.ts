import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AmbiguityHandler } from "../src/services/memory/ambiguity-handler";
import { ClaimExtractor, type Claim } from "../src/services/memory/claim-extractor";
import { ReVerifier, type ReVerificationReport } from "../src/services/memory/re-verifier";
import { HistoryManager } from "../src/services/memory/history-manager";
import { DateResolver } from "../src/services/date-resolver";
import type { ProcessedSearchResult } from "../src/services/search/result-processor";
import type { HistoryMatch } from "../src/services/memory/history-retriever";
import type { MessageWithToolCalls } from "../src/types/conversation.types";

describe("Conversation Memory, Recall & Ambiguity", () => {
  const fixedReference = new Date("2026-11-12T12:00:00Z");
  const dateResolver = new DateResolver(fixedReference);

  describe("AmbiguityHandler Reference Detection & Disambiguation", () => {
    const handler = new AmbiguityHandler();

    it("should detect date-only recall references", () => {
      const res1 = handler.detectReference("What did I ask on 3 November?", dateResolver);
      assert.ok(res1);
      assert.equal(res1.type, "date_only");
      if (res1.type === "date_only") {
        assert.match(res1.dateExpression, /3 November/i);
      }

      const res2 = handler.detectReference("What did I ask you on Monday?", dateResolver);
      assert.ok(res2);
      assert.equal(res2.type, "date_only");
      if (res2.type === "date_only") {
        assert.match(res2.dateExpression, /Monday/i);
      }
    });

    it("should detect combined date and topic references", () => {
      const res = handler.detectReference(
        "Last Tuesday I asked about Postgres hosting. Is your answer still correct?",
        dateResolver
      );
      assert.ok(res);
      assert.equal(res.type, "date_and_topic");
      if (res.type === "date_and_topic") {
        assert.match(res.dateExpression, /Last Tuesday/i);
        assert.match(res.topic, /Postgres hosting/i);
      }
    });

    it("should detect implicit follow-up re-verification queries", () => {
      const res1 = handler.detectReference("Is your answer still correct?", dateResolver);
      assert.ok(res1);
      assert.equal(res1.type, "implicit_followup");

      const res2 = handler.detectReference("Has anything changed since then?", dateResolver);
      assert.ok(res2);
      assert.equal(res2.type, "implicit_followup");
    });

    it("should format multiple history matches into a clean disambiguation prompt", () => {
      const mockMatches: HistoryMatch[] = [
        {
          message: {
            id: "msg_1",
            conversationId: "conv_1",
            role: "user",
            content: "Compare HubSpot and Salesforce for small teams",
            timestamp: new Date("2026-11-09T09:15:00Z"),
            createdAt: new Date("2026-11-09T09:15:00Z"),
            toolCallId: null,
            model: null,
            tokenCount: null,
          },
          assistantResponse: null,
          matchType: "exact_date",
          matchConfidence: 1.0,
        },
        {
          message: {
            id: "msg_2",
            conversationId: "conv_1",
            role: "user",
            content: "What is the best email marketing tool?",
            timestamp: new Date("2026-11-09T11:30:00Z"),
            createdAt: new Date("2026-11-09T11:30:00Z"),
            toolCallId: null,
            model: null,
            tokenCount: null,
          },
          assistantResponse: null,
          matchType: "exact_date",
          matchConfidence: 1.0,
        },
      ];

      const disambiguation = handler.formatDisambiguation(mockMatches);
      assert.match(disambiguation, /I found 2 conversations around that time/);
      assert.match(disambiguation, /Compare HubSpot and Salesforce/);
      assert.match(disambiguation, /Which specific topic/);
    });
  });

  describe("ClaimExtractor & Factual Prioritization", () => {
    const extractor = new ClaimExtractor();

    it("should extract verifiable metrics, pricing, and limits from text", () => {
      const text = `
Neon free tier provides 0.5 GB storage and 1 shared compute core.
Supabase free tier includes 500 MB database storage.
Railway Postgres starter plan costs $5/month.
      `;

      const claims = extractor.fallbackExtract(text);
      assert.ok(claims.length >= 3);

      const neonClaim = claims.find((c) => c.entity === "Neon");
      assert.ok(neonClaim);
      assert.match(neonClaim.originalValue || "", /0\.5\s*GB/i);
    });

    it("should prioritize quantitative claims over generic text", () => {
      const claims: Claim[] = [
        {
          id: "1",
          statement: "Postgres is very reliable and widely used by developers",
          isVerifiable: false,
        },
        {
          id: "2",
          statement: "Supabase free tier includes 500 MB database space",
          entity: "Supabase",
          originalValue: "500 MB",
          isVerifiable: true,
        },
      ];

      const prioritized = extractor.prioritize(claims);
      assert.equal(prioritized[0].id, "2");
      assert.equal(prioritized[0].isVerifiable, true);
    });

    it("should generate targeted verification queries modernized to the current year", () => {
      const claim: Claim = {
        id: "c1",
        statement: "Neon free tier provides 0.5 GB storage",
        entity: "Neon",
        subjectArea: "storage limit",
        originalValue: "0.5 GB",
        isVerifiable: true,
      };

      const queries = extractor.generateVerificationQueries(claim, 2026);
      assert.ok(queries.length > 0);
      assert.match(queries[0], /Neon storage limit 2026/);
    });
  });

  describe("ReVerifier Claim Verification & Reporting", () => {
    const reVerifier = new ReVerifier();

    it("should verify a claim as still_correct when search snippets confirm original value", () => {
      const claim: Claim = {
        id: "1",
        statement: "Neon free tier provides 0.5 GB storage",
        entity: "Neon",
        originalValue: "0.5 GB",
        isVerifiable: true,
      };

      const searchResults: ProcessedSearchResult[] = [
        {
          title: "Neon Pricing & Plans",
          url: "https://neon.tech/pricing",
          domain: "neon.tech",
          content: "The Neon Free Tier includes 0.5 GB storage and 1 project.",
          score: 0.95,
          qualityScore: 0.95,
          isAfterAnchor: true,
          isPrimarySource: true,
        },
      ];

      const result = reVerifier.heuristicVerify(claim, searchResults);
      assert.equal(result.status, "still_correct");
    });

    it("should verify a claim as outdated when search snippets show a different price", () => {
      const claim: Claim = {
        id: "2",
        statement: "Railway Postgres starter tier costs $5/month",
        entity: "Railway",
        originalValue: "$5",
        isVerifiable: true,
      };

      const searchResults: ProcessedSearchResult[] = [
        {
          title: "Railway Pricing Plans",
          url: "https://railway.app/pricing",
          domain: "railway.app",
          content: "Railway starter plan is now $10 per month.",
          score: 0.9,
          qualityScore: 0.9,
          isAfterAnchor: true,
          isPrimarySource: true,
        },
      ];

      const result = reVerifier.heuristicVerify(claim, searchResults);
      assert.equal(result.status, "outdated");
      assert.equal(result.currentValue, "$10");
    });

    it("should format structured report for LLM prompt context", () => {
      const mockReport: ReVerificationReport = {
        originalQuestion: "What are the cheapest Postgres hosting options?",
        originalAnswer: "Neon offers 0.5 GB free.",
        originalDate: new Date("2026-11-03T10:00:00Z"),
        claims: [
          {
            claim: {
              id: "c1",
              statement: "Neon offers 0.5 GB free",
              entity: "Neon",
              originalValue: "0.5 GB",
              isVerifiable: true,
            },
            status: "still_correct",
            evidence: [
              {
                title: "Neon Pricing",
                url: "https://neon.tech/pricing",
                domain: "neon.tech",
                content: "0.5 GB included free.",
                score: 0.9,
                qualityScore: 0.9,
                isAfterAnchor: true,
                isPrimarySource: true,
              },
            ],
            explanation: "Confirmed in official documentation.",
          },
        ],
        summary: "1 of 1 claims still correct.",
        searchesPerformed: 1,
      };

      const formatted = reVerifier.formatReportForLLM(mockReport);
      assert.match(formatted, /Conversation Recall & Factual Re-Verification/);
      assert.match(formatted, /STILL CORRECT/);
    });
  });

  describe("HistoryManager Context Management & Indexing", () => {
    const manager = new HistoryManager();

    it("should build a topic index from past user messages", () => {
      const messages: MessageWithToolCalls[] = [
        {
          id: "m1",
          conversationId: "conv_1",
          role: "user",
          content: "What Postgres hosting options are cheapest for a side project?",
          timestamp: new Date("2026-11-03T14:30:00Z"),
          createdAt: new Date("2026-11-03T14:30:00Z"),
          toolCallId: null,
          model: null,
          tokenCount: null,
        },
      ];

      const index = manager.buildTopicIndex(messages);
      assert.equal(index.length, 1);
      assert.equal(index[0].date, "2026-11-03");
      assert.match(index[0].topic, /Postgres hosting/i);
    });

    it("should trim conversation history while preserving system prompt and referenced turns", () => {
      const history = [
        { role: "system" as const, content: "System instructions" },
        { role: "user" as const, content: "Old turn 1" },
        { role: "user" as const, content: "Turn with important key fact" },
        { role: "user" as const, content: "Recent turn" },
      ];

      const trimmed = manager.trimHistory(history, 40, ["important key fact"]);
      assert.equal(trimmed[0].role, "system");
      assert.ok(trimmed.some((m) => typeof m.content === "string" && m.content.includes("important key fact")));
    });
  });
});
