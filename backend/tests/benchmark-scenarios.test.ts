import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateResolver } from "../src/services/date-resolver";
import { determineAnchorDate } from "../src/services/anchor-date";
import { AmbiguityHandler } from "../src/services/memory/ambiguity-handler";
import { ClaimExtractor } from "../src/services/memory/claim-extractor";
import { ReVerifier } from "../src/services/memory/re-verifier";
import { AnswerBuilder } from "../src/services/answer/answer-builder";
import { QueryBuilder } from "../src/services/query-builder";
import { MOCK_CRM_SEARCH_RESULTS, MOCK_POSTGRES_SEARCH_RESULTS } from "./fixtures/mock-data";

describe("Hiring Challenge Benchmark Scenarios (docs/task.md)", () => {
  // Fixed reference date: Thursday, 12 November 2026 12:00:00 UTC
  const fixedReference = new Date("2026-11-12T12:00:00Z");
  const dateResolver = new DateResolver(fixedReference);
  const ambiguityHandler = new AmbiguityHandler();
  const claimExtractor = new ClaimExtractor();
  const answerBuilder = new AnswerBuilder();
  const queryBuilder = new QueryBuilder(fixedReference);

  describe("Benchmark Scenario 1: CRM Tools Change Detection", () => {
    const prompt =
      "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?";

    it("should resolve 'Monday' and anchor date window relative to reference date", () => {
      // Thursday 12 Nov -> most recent Monday is 9 Nov 2026 (3 calendar days prior)
      const anchor = determineAnchorDate(prompt, [], dateResolver);
      assert.ok(anchor);
      assert.equal(anchor.source, "explicit_mention");
      assert.equal(anchor.anchorDate.getUTCDate(), 9);
      assert.equal(anchor.anchorDate.getUTCMonth(), 10); // Nov
      assert.equal(anchor.daysBetween, 3);
      assert.match(anchor.searchWindowDescription, /between Monday 9 Nov 2026 and today/);
    });

    it("should classify question type as change_detection and enforce headline-first table directives", () => {
      const anchor = determineAnchorDate(prompt, [], dateResolver);
      const questionType = answerBuilder.detectQuestionType(prompt, !!anchor, false);
      assert.equal(questionType, "change_detection");

      const promptDirective = answerBuilder.buildAnswerPrompt({
        userQuestion: prompt,
        questionType,
        searchResults: new Map(),
        entities: ["HubSpot", "Salesforce", "Pipedrive", "Zoho", "Close"],
        anchorDate: anchor?.anchorDate,
        todayDate: fixedReference,
      });

      assert.match(promptDirective, /CHANGE DETECTION FORMATTING DIRECTIVE/);
      assert.match(promptDirective, /Lead with a clear summary headline/);
      assert.match(promptDirective, /markdown summary table/);
      assert.match(promptDirective, /Changed/);
      assert.match(promptDirective, /No change found/);
    });

    it("should formulate targeted search queries including current year and entity names", () => {
      const entities = ["HubSpot", "Salesforce", "Pipedrive"];
      const qb = new QueryBuilder(fixedReference, new Date("2026-11-09T00:00:00Z"));
      const queries = entities.map((entity) =>
        qb.addTemporalFilter(qb.enrichQuery(`${entity} pricing 2022 updates`))
      );
      assert.equal(queries.length, 3);
      for (const q of queries) {
        assert.match(q, /2026/); // Modernized with current year
        assert.match(q, /since November 2026/); // Anchor date filter added
      }
      assert.match(queries[0], /HubSpot/);
      assert.match(queries[1], /Salesforce/);
      assert.match(queries[2], /Pipedrive/);
    });
  });

  describe("Benchmark Scenario 2: Date Lookup & Re-verification (3 November)", () => {
    const prompt = "What did I ask you on 3 November? Is your answer still correct today?";

    it("should detect exact date reference '3 November' and classify as date_only recall", () => {
      const reference = ambiguityHandler.detectReference(prompt, dateResolver);
      assert.ok(reference);
      assert.equal(reference.type, "date_only");
      if (reference.type === "date_only") {
        assert.match(reference.dateExpression, /3 November/i);
      }

      const resolution = dateResolver.resolve("3 November");
      assert.ok(resolution);
      assert.equal(resolution.resolvedDate.getUTCDate(), 3);
      assert.equal(resolution.resolvedDate.getUTCMonth(), 10); // Nov
      assert.equal(resolution.resolvedDate.getUTCFullYear(), 2026);
    });

    it("should detect re-verification intent and produce verified verdicts on claims", async () => {
      const isReverify = /\b(still\s+correct|accurate|changed|current|update|valid)\b/i.test(prompt);
      assert.equal(isReverify, true);

      const pastAnswer = `
        Neon free tier provides 0.5 GB storage.
        Supabase Pro plan is $25/month.
      `;

      const claims = claimExtractor.fallbackExtract(pastAnswer);
      assert.ok(claims.length >= 2);

      const reVerifier = new ReVerifier();
      const verified = claims.map((claim) =>
        reVerifier.heuristicVerify(claim, MOCK_POSTGRES_SEARCH_RESULTS)
      );

      assert.equal(verified.length, claims.length);
      const neonVerified = verified.find((v) => v.claim.entity === "Neon");
      assert.ok(neonVerified);
      assert.equal(neonVerified.status, "still_correct");
    });
  });

  describe("Benchmark Scenario 3: Relative Date Memory (Last Tuesday)", () => {
    const prompt = "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?";

    it("should resolve 'Last Tuesday' to the Tuesday of the PREVIOUS week", () => {
      // Reference: Thursday 12 Nov 2026.
      // Most recent past Tuesday was 10 Nov 2026.
      // 'Last Tuesday' MUST resolve to 3 Nov 2026 (previous week's Tuesday).
      const reference = ambiguityHandler.detectReference(prompt, dateResolver);
      assert.ok(reference);
      assert.equal(reference.type, "date_and_topic");
      if (reference.type === "date_and_topic") {
        assert.match(reference.dateExpression, /Last Tuesday/i);
        assert.match(reference.topic, /Postgres hosting/i);

        const resolution = dateResolver.resolve(reference.dateExpression);
        assert.ok(resolution);
        assert.equal(resolution.resolvedDate.getUTCDate(), 3); // 3 Nov 2026
        assert.equal(resolution.resolvedDate.getUTCMonth(), 10); // Nov
        assert.equal(resolution.resolvedDate.getUTCFullYear(), 2026);
      }
    });

    it("should extract claims from historical discussion and format re-verification report", async () => {
      const pastAssistantContent = `
        Neon Postgres: Free tier provides 0.5 GB storage. Launch plan is $19/month.
        Supabase Postgres: Free plan includes 500 MB database storage. Pro is $25/month.
      `;

      const claims = claimExtractor.fallbackExtract(pastAssistantContent);
      const reVerifier = new ReVerifier();
      const results = claims.map((claim) =>
        reVerifier.heuristicVerify(claim, MOCK_POSTGRES_SEARCH_RESULTS)
      );

      const reportBlock = reVerifier.formatReportForLLM({
        originalQuestion: "What are the best Postgres hosting options?",
        originalAnswer: pastAssistantContent,
        originalDate: new Date("2026-11-03T10:00:00Z"),
        claims: results,
        summary: "1 of 2 tools have changes since Tuesday 3 Nov 2026.",
        searchesPerformed: 2,
      });

      assert.match(reportBlock, /Conversation Recall & Factual Re-Verification/);
      assert.match(reportBlock, /Original Question Asked/);
      assert.match(reportBlock, /Claims Evaluated/);
    });
  });
});

