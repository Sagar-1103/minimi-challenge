import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryCacheStore } from "../../src/services/cache/cache.interface";
import { SearchDedup } from "../../src/services/search/dedup";
import { SourceEvaluator } from "../../src/services/search/source-evaluator";
import { ResultProcessor } from "../../src/services/search/result-processor";
import type { TavilySearchResult, TavilySearchResponse } from "../../src/lib/tavily";

describe("Search Strategy & Orchestration Tests", () => {
  describe("CacheStore & InMemoryCacheStore", () => {
    it("should store, retrieve, and delete items with key lookup", () => {
      const cache = new InMemoryCacheStore();
      cache.set("key1", { data: "test-data" });

      assert.equal(cache.has("key1"), true);
      assert.deepEqual(cache.get("key1"), { data: "test-data" });

      cache.delete("key1");
      assert.equal(cache.has("key1"), false);
      assert.equal(cache.get("key1"), null);
    });

    it("should respect TTL and expire items", async () => {
      const cache = new InMemoryCacheStore();
      // Set 1-second TTL
      cache.set("short-lived", "hello", 1);
      assert.equal(cache.get("short-lived"), "hello");

      // Wait 1.1s for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.equal(cache.get("short-lived"), null);
    });
  });

  describe("SearchDedup & Query Normalization", () => {
    const cache = new InMemoryCacheStore();
    const dedup = new SearchDedup(cache);

    it("should produce identical normalized keys regardless of word order or punctuation", () => {
      const key1 = dedup.normalizeQuery("HubSpot pricing 2026");
      const key2 = dedup.normalizeQuery("2026 HubSpot pricing!");
      const key3 = dedup.normalizeQuery("pricing, 2026 hubspot");

      assert.equal(key1, "2026 hubspot pricing");
      assert.equal(key2, "2026 hubspot pricing");
      assert.equal(key3, "2026 hubspot pricing");
    });

    it("should cache and return search responses on duplicate queries", async () => {
      const sampleResponse: TavilySearchResponse = {
        query: "Linear release notes 2026",
        results: [
          {
            title: "Linear Updates",
            url: "https://linear.app/changelog",
            content: "Linear shipped new roadmap features.",
            score: 0.95,
          },
        ],
      };

      await dedup.record("Linear release notes 2026", sampleResponse);

      // Re-ordered query should hit the same cache entry
      const cached = await dedup.checkCache("2026 release notes Linear");
      assert.ok(cached);
      assert.equal(cached.results.length, 1);
      assert.equal(cached.results[0].title, "Linear Updates");
    });

    it("should deduplicate search results with identical URLs", () => {
      const duplicates: TavilySearchResult[] = [
        { title: "Doc 1", url: "https://docs.stripe.com/api", content: "snippet 1", score: 0.8 },
        { title: "Doc 1 duplicate", url: "https://docs.stripe.com/api/", content: "snippet 1b", score: 0.8 },
        { title: "Doc 2", url: "https://stripe.com/pricing", content: "snippet 2", score: 0.8 },
      ];

      const unique = dedup.deduplicateResults(duplicates);
      assert.equal(unique.length, 2);
      assert.equal(unique[0].url, "https://docs.stripe.com/api");
      assert.equal(unique[1].url, "https://stripe.com/pricing");
    });
  });

  describe("SourceEvaluator & Dynamic Authority Detection", () => {
    const evaluator = new SourceEvaluator();

    it("should identify official domains dynamically for any entity name", () => {
      assert.equal(evaluator.isPrimarySource("https://linear.app/pricing", "Linear"), true);
      assert.equal(evaluator.isPrimarySource("https://supabase.com/docs", "Supabase"), true);
      assert.equal(evaluator.isPrimarySource("https://postgresql.org/docs", "PostgreSQL"), true);
    });

    it("should recognize standard documentation subdomains as primary", () => {
      assert.equal(evaluator.isPrimarySource("https://docs.github.com/copilot"), true);
      assert.equal(evaluator.isPrimarySource("https://blog.cloudflare.com/workers"), true);
      assert.equal(evaluator.isPrimarySource("https://changelog.railway.app"), true);
    });

    it("should return false for third-party aggregators or forums", () => {
      assert.equal(evaluator.isPrimarySource("https://reddit.com/r/devops", "Postgres"), false);
      assert.equal(evaluator.isPrimarySource("https://g2.com/products/hubspot", "HubSpot"), false);
    });

    it("should score primary, recent sources higher than third-party stale sources", () => {
      const anchorDate = new Date("2026-11-01T00:00:00Z");

      const primaryFresh: TavilySearchResult = {
        title: "Official Pricing",
        url: "https://neon.tech/pricing",
        content: "New pricing announced.",
        score: 0.9,
        publishedDate: "2026-11-10T00:00:00Z", // After anchor date
      };

      const thirdPartyStale: TavilySearchResult = {
        title: "Old forum post",
        url: "https://forum.example.com/topic/123",
        content: "Old discussion.",
        score: 0.6,
        publishedDate: "2025-05-01T00:00:00Z", // Stale
      };

      const scorePrimary = evaluator.scoreSource(primaryFresh, "Neon", anchorDate);
      const scoreThirdParty = evaluator.scoreSource(thirdPartyStale, "Neon", anchorDate);

      assert.ok(scorePrimary > scoreThirdParty);
      assert.ok(scorePrimary >= 0.8);
    });
  });

  describe("ResultProcessor Ranking & Formatting", () => {
    const processor = new ResultProcessor();

    it("should sort processed results by quality score descending", () => {
      const rawResults: TavilySearchResult[] = [
        {
          title: "Random review",
          url: "https://reviews.example.com/item",
          content: "Average product.",
          score: 0.5,
        },
        {
          title: "Official Docs",
          url: "https://supabase.com/pricing",
          content: "Official database plans.",
          score: 0.95,
        },
      ];

      const processed = processor.process(rawResults, { entity: "Supabase" });
      assert.equal(processed.length, 2);
      assert.equal(processed[0].title, "Official Docs");
      assert.equal(processed[0].isPrimarySource, true);
    });

    it("should truncate long content snippets cleanly without breaking words", () => {
      const longText = "A".repeat(1200);
      const truncated = processor.cleanContent(longText, 200);
      assert.ok(truncated.length <= 205);
      assert.ok(truncated.endsWith("..."));
    });

    it("should format results into structured markdown with badges for the LLM", () => {
      const rawResults: TavilySearchResult[] = [
        {
          title: "Pricing Page",
          url: "https://resend.com/pricing",
          content: "Email API pricing starts free.",
          score: 0.9,
          publishedDate: "2026-11-10",
        },
      ];

      const processed = processor.process(rawResults, {
        entity: "Resend",
        anchorDate: new Date("2026-11-01"),
      });
      const formatted = processor.formatForLLM(processed);

      assert.match(formatted, /### Result 1: Pricing Page/);
      assert.match(formatted, /Primary Source/);
      assert.match(formatted, /Updated After Anchor Date/);
      assert.match(formatted, /https:\/\/resend\.com\/pricing/);
    });
  });
});
