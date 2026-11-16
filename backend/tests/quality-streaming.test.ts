import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TableFormatter } from "../src/services/answer/table-formatter";
import { CitationEngine } from "../src/services/answer/citation-engine";
import { ConfidenceCalibrator } from "../src/services/answer/confidence-calibrator";
import { AgentEventEmitter } from "../src/services/agent-emitter";
import { MOCK_CRM_SEARCH_RESULTS } from "./fixtures/mock-data";

describe("Answer Quality, Table Formatting & SSE Streaming Protocol", () => {
  const tableFormatter = new TableFormatter();
  const citationEngine = new CitationEngine();
  const calibrator = new ConfidenceCalibrator();

  describe("Table Formatting & Comparisons", () => {
    it("should format a valid markdown comparison table with headers, separators, and sources", () => {
      const citations = citationEngine.extractCitations("", MOCK_CRM_SEARCH_RESULTS);
      const markdown = tableFormatter.formatComparisonTable(
        [
          {
            name: "HubSpot",
            values: { Pricing: "$90/seat/mo", BestFor: "SMB to Mid-market" },
            sources: [citations[0]],
          },
          {
            name: "Salesforce",
            values: { Pricing: "$25/user/mo (Starter)", BestFor: "Enterprise & scalable teams" },
            sources: [citations[1]],
          },
        ],
        ["Pricing", "BestFor"]
      );

      assert.match(markdown, /\|\s*Entity\s*\|\s*Pricing\s*\|\s*BestFor\s*\|\s*Sources\s*\|/);
      assert.match(markdown, /\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*\|/);
      assert.match(markdown, /\|\s*\*\*HubSpot\*\*\s*\|\s*\$90\/seat\/mo/);
      assert.match(markdown, /\|\s*\*\*Salesforce\*\*\s*\|\s*\$25\/user\/mo/);
      assert.match(markdown, /\[HubSpot Pricing & Plans 2026 - Official\]\(https:\/\/www\.hubspot\.com\/pricing\/crm\)/);
    });

    it("should generate change-detection tables explicitly marking '⚠️ Changed' vs '✅ No change found'", () => {
      const markdown = tableFormatter.formatChangeTable([
        {
          name: "HubSpot",
          status: "changed",
          changes: [{ aspect: "Sales Hub Pricing", status: "changed", detail: "Updated to $90/seat" }],
          sources: [],
        },
        {
          name: "Pipedrive",
          status: "no_change_found",
          changes: [{ aspect: "Pricing", status: "no_change_found", detail: "Confirmed unchanged" }],
          sources: [],
        },
      ]);

      assert.match(markdown, /\|\s*Tool\s*\|\s*Status\s*\|\s*Notable Updates\s*\|\s*Sources\s*\|/);
      assert.match(markdown, /⚠️ Changed/);
      assert.match(markdown, /✅ No change found/);
    });
  });

  describe("Confidence Calibration & Inline Citations", () => {
    it("should calibrate confidence as high when official primary sources confirm facts", () => {
      const confidence = calibrator.assess("HubSpot pricing", MOCK_CRM_SEARCH_RESULTS);

      assert.equal(confidence.level, "high");
      assert.match(confidence.reasoning, /primary source|vendor/i);
    });

    it("should format inline citations with markdown links and publication dates", () => {
      const citations = citationEngine.extractCitations("", MOCK_CRM_SEARCH_RESULTS);
      assert.ok(citations.length >= 2);
      assert.equal(citations[0].domain, "hubspot.com");
      assert.equal(citations[0].isPrimarySource, true);

      const inline = citationEngine.formatInlineCitation(MOCK_CRM_SEARCH_RESULTS[0]);
      assert.match(inline, /\[HubSpot Pricing & Plans 2026 - Official\]\(https:\/\/www\.hubspot\.com\/pricing\/crm\)/);
    });
  });

  describe("SSE Streaming Protocol Event Ordering", () => {
    it("should emit events in the strict sequence required by the SSE protocol", () => {
      const emitter = new AgentEventEmitter();
      const events: string[] = [];

      emitter.on("status", () => events.push("status"));
      emitter.on("tool_start", () => events.push("tool_start"));
      emitter.on("tool_end", () => events.push("tool_end"));
      emitter.on("answer_start", () => events.push("answer_start"));
      emitter.on("answer_chunk", () => events.push("answer_chunk"));
      emitter.on("answer_end", () => events.push("answer_end"));
      emitter.on("sources", () => events.push("sources"));
      emitter.on("done", () => events.push("done"));

      // Trigger standard agent execution lifecycle
      emitter.emitStatus("Analyzing query...");
      emitter.emitToolStart("web_search", "HubSpot pricing 2026", 0);
      emitter.emitToolEnd("web_search", "HubSpot pricing 2026", 3, 450);
      emitter.emitAnswerStart();
      emitter.emitAnswerChunk("HubSpot pricing is $90/seat/month.");
      emitter.emitAnswerEnd("HubSpot pricing is $90/seat/month.");
      emitter.emitSources([
        {
          index: 1,
          title: "HubSpot",
          url: "https://hubspot.com",
          domain: "hubspot.com",
          accessedDate: "2026-11-12",
          isPrimarySource: true,
        },
      ]);
      emitter.emitDone("conv_123", "msg_456");

      assert.deepEqual(events, [
        "status",
        "tool_start",
        "tool_end",
        "answer_start",
        "answer_chunk",
        "answer_end",
        "sources",
        "done",
      ]);
    });
  });
});

