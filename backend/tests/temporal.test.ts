import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateResolver } from "../src/services/date-resolver";
import { determineAnchorDate } from "../src/services/anchor-date";
import { QueryBuilder } from "../src/services/query-builder";
import { buildSystemPrompt } from "../src/prompts/system";

describe("Temporal Grounding & Calendar Intelligence", () => {
  // Fixed reference date: Thursday, 12 November 2026 12:00:00 UTC
  const fixedReference = new Date("2026-11-12T12:00:00Z");
  const resolver = new DateResolver(fixedReference);

  describe("DateResolver Unit & Edge Cases", () => {
    it("should resolve bare 'Monday' to the most recent past Monday", () => {
      // Thursday 12 Nov 2026 -> most recent Monday is 9 Nov 2026
      const res = resolver.resolve("Monday");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCFullYear(), 2026);
      assert.equal(res.resolvedDate.getUTCMonth(), 10); // 0-indexed: 10 = Nov
      assert.equal(res.resolvedDate.getUTCDate(), 9);
      assert.match(res.formatted, /Monday 9 Nov 2026/);
    });

    it("should resolve 'last Monday' to Monday of the PREVIOUS week", () => {
      // Thursday 12 Nov 2026 -> previous week Monday is 2 Nov 2026 (7 days before 9 Nov)
      const res = resolver.resolve("last Monday");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCFullYear(), 2026);
      assert.equal(res.resolvedDate.getUTCMonth(), 10);
      assert.equal(res.resolvedDate.getUTCDate(), 2);
      assert.match(res.formatted, /Monday 2 Nov 2026/);
    });

    it("should resolve bare 'Tuesday' to the most recent past Tuesday", () => {
      // Thursday 12 Nov 2026 -> most recent Tuesday is 10 Nov 2026
      const res = resolver.resolve("Tuesday");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCDate(), 10);
      assert.match(res.formatted, /Tuesday 10 Nov 2026/);
    });

    it("should resolve 'last Tuesday' to Tuesday of the PREVIOUS week", () => {
      // Thursday 12 Nov 2026 -> previous week Tuesday is 3 Nov 2026
      const res = resolver.resolve("last Tuesday");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCDate(), 3);
      assert.match(res.formatted, /Tuesday 3 Nov 2026/);
    });

    it("should resolve 'yesterday' to referenceDate minus 1 day", () => {
      const res = resolver.resolve("yesterday");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCDate(), 11);
    });

    it("should resolve 'two days ago' to referenceDate minus 2 days", () => {
      const res = resolver.resolve("two days ago");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCDate(), 10);
    });

    it("should resolve 'last week' to 7 days prior", () => {
      const res = resolver.resolve("last week");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCDate(), 5);
      assert.equal(res.confidence, "inferred");
    });

    it("should resolve 'end of last month' to the last day of October 2026", () => {
      const res = resolver.resolve("end of last month");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCMonth(), 9); // October
      assert.equal(res.resolvedDate.getUTCDate(), 31);
    });

    it("should resolve '3 November' to 3 Nov 2026 (past date in current year)", () => {
      const res = resolver.resolve("3 November");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCFullYear(), 2026);
      assert.equal(res.resolvedDate.getUTCMonth(), 10);
      assert.equal(res.resolvedDate.getUTCDate(), 3);
      assert.equal(res.confidence, "inferred");
      assert.match(res.assumption || "", /Assumed year 2026/);
    });

    it("should resolve '3 December' to 3 Dec 2025 (future date relative to Nov 12)", () => {
      const res = resolver.resolve("3 December");
      assert.ok(res);
      assert.equal(res.resolvedDate.getUTCFullYear(), 2025);
      assert.equal(res.resolvedDate.getUTCMonth(), 11); // December
      assert.equal(res.resolvedDate.getUTCDate(), 3);
      assert.equal(res.confidence, "inferred");
      assert.match(res.assumption || "", /since it has not occurred yet this year/);
    });

    it("should extract date expressions from natural user text", () => {
      const text =
        "We shortlisted 5 CRM tools on Monday. Has any changed pricing since 3 November?";
      const extracted = resolver.extractDateExpressions(text);
      assert.equal(extracted.length, 2);
      assert.equal(extracted[0].expression.toLowerCase(), "monday");
      assert.equal(extracted[1].expression.toLowerCase(), "3 november");
    });
  });

  describe("Anchor Date Determination", () => {
    it("should identify anchor date from explicit relative date mention", () => {
      const userMessage = "Has any tool changed pricing since Monday?";
      const anchor = determineAnchorDate(userMessage, [], resolver);

      assert.ok(anchor);
      assert.equal(anchor.source, "explicit_mention");
      assert.equal(anchor.anchorDate.getUTCDate(), 9); // Monday 9 Nov 2026
      assert.equal(anchor.daysBetween, 3);
      assert.match(anchor.searchWindowDescription, /between Monday 9 Nov 2026 and today/);
    });

    it("should fallback to previous turn in history if user asks a change query without explicit date", () => {
      const userMessage = "Has any of them changed their pricing since then?";
      const history = [
        {
          role: "user",
          content: "Can you list HubSpot and Salesforce pricing?",
          createdAt: new Date("2026-11-08T10:00:00Z"),
        },
        {
          role: "assistant",
          content: "Here are the current prices for HubSpot and Salesforce...",
          createdAt: new Date("2026-11-08T10:01:00Z"),
        },
      ];

      const anchor = determineAnchorDate(userMessage, history, resolver);
      assert.ok(anchor);
      assert.equal(anchor.source, "previous_turn");
      assert.equal(anchor.anchorDate.getUTCDate(), 8);
      assert.equal(anchor.daysBetween, 4);
    });

    it("should return null for queries with no temporal or change intent", () => {
      const userMessage = "What is the capital of Australia?";
      const anchor = determineAnchorDate(userMessage, [], resolver);
      assert.equal(anchor, null);
    });
  });

  describe("Date-Aware QueryBuilder", () => {
    const qb = new QueryBuilder(fixedReference, new Date("2026-11-09T00:00:00Z"));

    it("should modernize outdated years with current year", () => {
      const res = qb.modernizeStaleYears("Linear release 2023");
      assert.equal(res, "Linear release 2026");
    });

    it("should not modify queries that already have the current year", () => {
      const res = qb.modernizeStaleYears("Salesforce revenue 2026");
      assert.equal(res, "Salesforce revenue 2026");
    });

    it("should leave queries without a year untouched", () => {
      const res = qb.modernizeStaleYears("What is a database index");
      assert.equal(res, "What is a database index");
    });

    it("should add temporal filter when anchor date is present", () => {
      const res = qb.addTemporalFilter("Postgres updates");
      assert.match(res, /Postgres updates since November 2026/);
    });
  });

  describe("System Prompt Temporal Injection", () => {
    it("should inject current date, day of week, and year into system prompt", () => {
      const prompt = buildSystemPrompt({
        referenceDate: fixedReference,
        timezone: "UTC",
      });

      assert.ok(prompt.includes("Thursday, November 12, 2026"));
      assert.ok(prompt.includes("Current year**: 2026"));
      assert.ok(prompt.includes("Day of week**: Thursday"));
    });

    it("should inject anchor date details when provided", () => {
      const anchor = determineAnchorDate(
        "Has anything changed since Monday?",
        [],
        resolver
      );

      const prompt = buildSystemPrompt({
        referenceDate: fixedReference,
        timezone: "UTC",
        anchorDate: anchor,
      });

      assert.ok(prompt.includes("Reference point (Anchor Date)"));
      assert.ok(prompt.includes("Search window"));
    });
  });
});
