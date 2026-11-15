import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CitationEngine, type Citation } from "../../src/services/answer/citation-engine";
import { ConfidenceCalibrator } from "../../src/services/answer/confidence-calibrator";
import {
  TableFormatter,
  type EntityComparison,
  type EntityChangeReport,
} from "../../src/services/answer/table-formatter";
import { DiffReporter } from "../../src/services/answer/diff-reporter";
import { AnswerBuilder, type AnswerContext } from "../../src/services/answer/answer-builder";
import type { ProcessedSearchResult } from "../../src/services/search/result-processor";
import type { Claim } from "../../src/services/memory/claim-extractor";
import type { VerificationResult } from "../../src/services/memory/re-verifier";

describe("Answer Synthesis & Quality Integration Tests", () => {
  describe("CitationEngine Inline Formatting & References", () => {
    const engine = new CitationEngine();

    const sampleResult: ProcessedSearchResult = {
      title: "HubSpot Pricing",
      url: "https://hubspot.com/pricing",
      domain: "hubspot.com",
      content: "Starter CRM is now $20/user/month.",
      score: 0.95,
      qualityScore: 0.95,
      publishedDate: "2026-11-01",
      isAfterAnchor: true,
      isPrimarySource: true,
    };

    it("should format inline citation with title, link, and publication date", () => {
      const citation = engine.formatInlineCitation(sampleResult);
      assert.match(citation, /\[HubSpot Pricing\]\(https:\/\/hubspot\.com\/pricing\)/);
      assert.match(citation, /\(2026-11-01\)/);
    });

    it("should construct numbered references footer with official badges", () => {
      const citations: Citation[] = [
        {
          index: 1,
          title: "HubSpot Pricing",
          url: "https://hubspot.com/pricing",
          domain: "hubspot.com",
          publishedDate: "2026-11-01",
          accessedDate: "2026-11-12",
          isPrimarySource: true,
        },
      ];

      const refSection = engine.buildReferenceSection(citations);
      assert.match(refSection, /### Sources/);
      assert.match(refSection, /1\. \[HubSpot Pricing\]\(https:\/\/hubspot\.com\/pricing\)/);
      assert.match(refSection, /\[Official Source\]/);
    });

    it("should extract citations used in text from available search results", () => {
      const answerText =
        "HubSpot increased prices according to [HubSpot Pricing](https://hubspot.com/pricing).";
      const extracted = engine.extractCitations(answerText, [sampleResult]);

      assert.equal(extracted.length, 1);
      assert.equal(extracted[0].url, "https://hubspot.com/pricing");
      assert.equal(extracted[0].isPrimarySource, true);
    });
  });

  describe("ConfidenceCalibrator Quality Rules", () => {
    const calibrator = new ConfidenceCalibrator();

    it("should assign high confidence for primary official source updated recently", () => {
      const evidence: ProcessedSearchResult[] = [
        {
          title: "Neon Official Pricing",
          url: "https://neon.tech/pricing",
          domain: "neon.tech",
          content: "Official database plans.",
          score: 0.95,
          qualityScore: 0.95,
          publishedDate: "2026-11-10",
          isAfterAnchor: true,
          isPrimarySource: true,
        },
      ];

      const assessment = calibrator.assess("Neon free tier is 0.5 GB", evidence);
      assert.equal(assessment.level, "high");
      assert.equal(assessment.badge, "✅");
      assert.match(assessment.reasoning, /official vendor documentation/i);
    });

    it("should assign medium confidence for secondary tech press reporting", () => {
      const evidence: ProcessedSearchResult[] = [
        {
          title: "TechCrunch Article",
          url: "https://techcrunch.com/2026/11/news",
          domain: "techcrunch.com",
          content: "Vendor announced updates.",
          score: 0.8,
          qualityScore: 0.7,
          isAfterAnchor: true,
          isPrimarySource: false,
        },
      ];

      const assessment = calibrator.assess("Vendor released feature", evidence);
      assert.equal(assessment.level, "medium");
      assert.equal(assessment.badge, "⚠️");
    });

    it("should assign low confidence for community forum or aggregator discussions", () => {
      const evidence: ProcessedSearchResult[] = [
        {
          title: "Reddit Thread",
          url: "https://reddit.com/r/devops/comments/123",
          domain: "reddit.com",
          content: "Someone mentioned price change.",
          score: 0.5,
          qualityScore: 0.4,
          isAfterAnchor: false,
          isPrimarySource: false,
        },
      ];

      const assessment = calibrator.assess("Unconfirmed rumor", evidence);
      assert.equal(assessment.level, "low");
      assert.equal(assessment.badge, "❓");
    });

    it("should assess unverifiable when no evidence is supplied", () => {
      const assessment = calibrator.assess("Missing claim", []);
      assert.equal(assessment.level, "unverifiable");
      assert.equal(assessment.badge, "❌");
    });

    it("should aggregate overall confidence level accurately", () => {
      const highOnly = [
        calibrator.assess("c1", [
          {
            title: "T1",
            url: "https://neon.tech",
            domain: "neon.tech",
            content: "",
            score: 1,
            qualityScore: 0.9,
            isAfterAnchor: true,
            isPrimarySource: true,
          },
        ]),
      ];
      assert.equal(calibrator.assessOverall(highOnly), "high");
    });
  });

  describe("TableFormatter Markdown Tables", () => {
    const formatter = new TableFormatter();

    it("should format multi-entity comparison tables with dynamic columns", () => {
      const entities: EntityComparison[] = [
        {
          name: "Neon",
          values: { Storage: "0.5 GB", Pricing: "Free", Compute: "1 Shared" },
          sources: [
            {
              index: 1,
              title: "Neon Pricing",
              url: "https://neon.tech/pricing",
              domain: "neon.tech",
              accessedDate: "2026-11-12",
            },
          ],
        },
        {
          name: "Supabase",
          values: { Storage: "500 MB", Pricing: "Free", Compute: "Shared" },
          sources: [],
        },
      ];

      const table = formatter.formatComparisonTable(entities, [
        "Storage",
        "Pricing",
        "Compute",
      ]);

      assert.match(table, /\| Entity \| Storage \| Pricing \| Compute \| Sources \|/);
      assert.match(table, /\|\s*\*\*Neon\*\*\s*\|\s*0\.5 GB\s*\|\s*Free\s*\|\s*1 Shared\s*\|/);
      assert.match(table, /\[Neon Pricing\]\(https:\/\/neon\.tech\/pricing\)/);
    });

    it("should format change detection tables with badges distinguishing changed vs no change vs unverified", () => {
      const reports: EntityChangeReport[] = [
        {
          name: "HubSpot",
          status: "changed",
          changes: [{ aspect: "Pricing", status: "changed", detail: "Starter now $20/user/mo (was $18)" }],
          sources: [
            {
              index: 1,
              title: "HubSpot",
              url: "https://hubspot.com",
              domain: "hubspot.com",
              accessedDate: "2026-11-12",
            },
          ],
        },
        {
          name: "Salesforce",
          status: "no_change_found",
          changes: [],
          sources: [],
        },
        {
          name: "FreshSales",
          status: "unverified",
          changes: [],
          sources: [],
        },
      ];

      const table = formatter.formatChangeTable(reports);
      assert.match(table, /\*\*1 of 3 tools have changes:\*\*/);
      assert.match(table, /⚠️ Changed/);
      assert.match(table, /✅ No change found/);
      assert.match(table, /❓ Couldn't verify/);
    });

    it("should format verification results table", () => {
      const results: VerificationResult[] = [
        {
          claim: {
            id: "1",
            statement: "Neon provides 0.5 GB storage",
            entity: "Neon",
            originalValue: "0.5 GB",
            isVerifiable: true,
          },
          status: "still_correct",
          evidence: [],
          explanation: "Confirmed in official documentation.",
        },
      ];

      const table = formatter.formatVerificationTable(results);
      assert.match(table, /\| Entity \/ Claim \| Status \| Current Value \| Reason \/ Evidence \|/);
      assert.match(table, /✅ Still Correct/);
      assert.match(table, /0\.5 GB/);
    });
  });

  describe("DiffReporter Headline & Item Generation", () => {
    const diffReporter = new DiffReporter();

    it("should generate a diff highlighting changed and unchanged claims", () => {
      const oldClaims: Claim[] = [
        {
          id: "1",
          statement: "Railway costs $5/month",
          entity: "Railway",
          subjectArea: "pricing",
          originalValue: "$5",
          isVerifiable: true,
        },
        {
          id: "2",
          statement: "Neon free tier gives 0.5 GB storage",
          entity: "Neon",
          subjectArea: "storage",
          originalValue: "0.5 GB",
          isVerifiable: true,
        },
      ];

      const currentResults = new Map<string, ProcessedSearchResult[]>([
        [
          "Railway",
          [
            {
              title: "Railway Pricing",
              url: "https://railway.app/pricing",
              domain: "railway.app",
              content: "Railway pricing is now $10/month for starters.",
              score: 0.9,
              qualityScore: 0.9,
              isAfterAnchor: true,
              isPrimarySource: true,
            },
          ],
        ],
        [
          "Neon",
          [
            {
              title: "Neon Storage",
              url: "https://neon.tech/docs",
              domain: "neon.tech",
              content: "Neon offers 0.5 GB storage on free tier.",
              score: 0.9,
              qualityScore: 0.9,
              isAfterAnchor: true,
              isPrimarySource: true,
            },
          ],
        ],
      ]);

      const diff = diffReporter.generateDiff(oldClaims, currentResults);
      assert.equal(diff.changes.length, 1);
      assert.equal(diff.changes[0].entity, "Railway");
      assert.equal(diff.changes[0].newValue, "$10");

      assert.equal(diff.noChanges.length, 1);
      assert.equal(diff.noChanges[0].entity, "Neon");

      const formatted = diffReporter.formatDiff(diff);
      assert.match(formatted, /1 of 2 items have changed/);
      assert.match(formatted, /⚠️ Confirmed Changes/);
      assert.match(formatted, /✅ No Changes Detected/);
    });
  });

  describe("AnswerBuilder Classification & Post-Processing", () => {
    const builder = new AnswerBuilder();

    it("should accurately classify question types", () => {
      assert.equal(
        builder.detectQuestionType("Has any tool changed pricing since Monday?", true),
        "change_detection"
      );
      assert.equal(
        builder.detectQuestionType("Compare HubSpot and Salesforce for sales teams"),
        "multi_entity_comparison"
      );
      assert.equal(
        builder.detectQuestionType("Is your answer still correct?", false, true),
        "re_verification"
      );
      assert.equal(
        builder.detectQuestionType("What is the price of Linear?"),
        "simple_fact"
      );
    });

    it("should extract entity proper nouns from user queries", () => {
      const entities = builder.extractEntities(
        "Compare HubSpot, Salesforce, and Zoho CRM for a small business"
      );
      assert.ok(entities.includes("HubSpot"));
      assert.ok(entities.includes("Salesforce"));
      assert.ok(entities.includes("Zoho CRM") || entities.includes("Zoho"));
    });

    it("should post-process answers to check entity coverage and append citations", () => {
      const context: AnswerContext = {
        userQuestion: "What is the price of HubSpot and Salesforce?",
        questionType: "multi_entity_comparison",
        searchResults: new Map([
          [
            "HubSpot",
            [
              {
                title: "HubSpot Pricing",
                url: "https://hubspot.com/pricing",
                domain: "hubspot.com",
                content: "Starter is $20/mo",
                score: 0.9,
                qualityScore: 0.9,
                isAfterAnchor: true,
                isPrimarySource: true,
              },
            ],
          ],
        ]),
        entities: ["HubSpot", "Salesforce"],
        todayDate: new Date("2026-11-12T12:00:00Z"),
      };

      const rawAnswer =
        "HubSpot costs $20/user/month ([HubSpot Pricing](https://hubspot.com/pricing)). I could not find information for Salesforce.";

      const processed = builder.postProcess(rawAnswer, context);
      assert.ok(processed.entitiesCovered.includes("HubSpot"));
      assert.ok(processed.entitiesCovered.includes("Salesforce"));
      assert.equal(processed.entitiesMissed.length, 0);
      assert.equal(processed.citations.length, 1);
      assert.match(processed.content, /### Sources/);
    });
  });
});
