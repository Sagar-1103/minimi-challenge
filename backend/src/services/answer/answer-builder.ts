import type { ProcessedSearchResult } from "../search/result-processor";
import type { VerificationResult } from "../memory/re-verifier";
import { CitationEngine, citationEngine, type Citation } from "./citation-engine";
import {
  ConfidenceCalibrator,
  confidenceCalibrator,
  type ConfidenceLevel,
} from "./confidence-calibrator";

export type QuestionType =
  | "simple_fact"
  | "multi_entity_comparison"
  | "change_detection"
  | "re_verification"
  | "general_knowledge"
  | "hybrid";

export interface AnswerContext {
  userQuestion: string;
  questionType: QuestionType;
  searchResults: Map<string, ProcessedSearchResult[]>;
  previousAnswer?: string;
  claims?: VerificationResult[];
  entities: string[];
  anchorDate?: Date;
  todayDate: Date;
}

export interface ProcessedAnswer {
  content: string;
  citations: Citation[];
  entitiesCovered: string[];
  entitiesMissed: string[];
  confidenceLevel: ConfidenceLevel;
}

export class AnswerBuilder {
  constructor(
    private citations: CitationEngine = citationEngine,
    private calibrator: ConfidenceCalibrator = confidenceCalibrator
  ) {}

  // Classify query intent to select the optimal answer synthesis layout
  detectQuestionType(
    question: string,
    hasAnchorDate = false,
    isReverify = false
  ): QuestionType {
    if (isReverify) return "re_verification";

    const clean = question.trim().toLowerCase();

    if (
      hasAnchorDate ||
      /\b(changed|since|updates?|new releases?|difference|diff)\b/i.test(clean)
    ) {
      return "change_detection";
    }

    if (
      /\b(compare|comparison|versus|\bvs\b|alternative|options|tools)\b/i.test(
        clean
      ) ||
      this.extractEntities(question).length >= 2
    ) {
      return "multi_entity_comparison";
    }

    if (/\b(price|pricing|cost|limit|quota|version|when was|who is|what is)\b/i.test(clean)) {
      return "simple_fact";
    }

    return "hybrid";
  }

  // Extract candidate entity names mentioned in the question (capitalized terms and known product patterns)
  extractEntities(question: string): string[] {
    const entities: string[] = [];
    if (!question) return entities;

    // Match proper nouns or capitalized phrases (e.g. "HubSpot", "Postgres", "AWS Aurora")
    const matches = question.match(
      /\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*)\b/g
    );

    const stopWords = new Set([
      "What",
      "Which",
      "Where",
      "When",
      "Why",
      "How",
      "Who",
      "Can",
      "Could",
      "Would",
      "Should",
      "Is",
      "Are",
      "Has",
      "Have",
      "Did",
      "Does",
      "Tell",
      "Show",
      "Give",
      "Explain",
      "Compare",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ]);

    if (matches) {
      for (const m of matches) {
        if (!stopWords.has(m) && m.length > 2 && !entities.includes(m)) {
          entities.push(m);
        }
      }
    }

    return entities;
  }

  // Generate specialized formatting directives based on question type
  buildAnswerPrompt(context: AnswerContext): string {
    const instructions: string[] = [];

    switch (context.questionType) {
      case "change_detection":
        instructions.push(
          "CHANGE DETECTION FORMATTING DIRECTIVE:",
          "- Lead with a clear summary headline stating how many items changed (e.g., '**2 of 5 tools have changes since [Date]:**').",
          "- Present a markdown summary table covering every queried entity with columns: Tool | Status | Notable Updates | Sources.",
          "- Explicitly distinguish between:",
          "  • '⚠️ Changed' (confirmed price increase, limit change, or feature release)",
          "  • '✅ No change found' (searched and confirmed unchanged)",
          "  • '❓ Couldn't verify' (information was not found or was inconclusive in search results).",
          "- Never guess or assume that an unverified tool is unchanged."
        );
        break;

      case "multi_entity_comparison":
        instructions.push(
          "COMPARISON FORMATTING DIRECTIVE:",
          "- Include a clean markdown comparison table with each tool as a row and key queried dimensions as columns.",
          "- Include inline markdown citations in the sources column for verified metrics.",
          "- Follow the table with a concise 2-3 sentence takeaway or trade-off summary."
        );
        break;

      case "re_verification":
        instructions.push(
          "RE-VERIFICATION FORMATTING DIRECTIVE:",
          "- Restate what the user originally asked and your previous answer concisely.",
          "- Present a clear verdict for each factual claim: '✅ Still Correct', '⚠️ Outdated (New Value: X)', or '❓ Couldn't Verify'.",
          "- Cite current search sources for each verified claim."
        );
        break;

      case "simple_fact":
        instructions.push(
          "FACTUAL SYNTHESIS DIRECTIVE:",
          "- State the direct answer in the very first sentence.",
          "- Provide supporting context with inline citation [Source](URL).",
          "- Note the date the information was checked or published."
        );
        break;

      default:
        instructions.push(
          "GENERAL SYNTHESIS DIRECTIVE:",
          "- Deliver a direct, answer-first response.",
          "- Structure complex information with clear markdown headings, bullet points, or tables.",
          "- Include inline citations for all factual assertions."
        );
        break;
    }

    return instructions.join("\n");
  }

  // Completeness check prompt to ensure all queried entities and criteria are fulfilled
  buildCompletenessCheck(context: AnswerContext): string {
    const entityList =
      context.entities.length > 0 ? context.entities.join(", ") : "all requested topics";

    return [
      "COMPLETENESS VERIFICATION CHECKLIST:",
      `1. Have you explicitly addressed each entity (${entityList})?`,
      "2. Are all time-sensitive statements accompanied by an inline citation and date?",
      "3. Did you clearly separate 'no change found' from 'couldn't verify'?",
      "4. Does your answer lead directly with the key conclusion without introductory filler?",
    ].join("\n");
  }

  // Post-process the generated response to check coverage, citations, and confidence calibration
  postProcess(answer: string, context: AnswerContext): ProcessedAnswer {
    const allResults: ProcessedSearchResult[] = [];
    for (const resList of context.searchResults.values()) {
      allResults.push(...resList);
    }

    const citations = this.citations.extractCitations(
      answer,
      allResults,
      context.todayDate
    );

    // Track entity coverage
    const entitiesCovered: string[] = [];
    const entitiesMissed: string[] = [];

    for (const ent of context.entities) {
      const regex = new RegExp(`\\b${ent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(answer)) {
        entitiesCovered.push(ent);
      } else {
        entitiesMissed.push(ent);
      }
    }

    // Assess confidence
    const assessments = citations.map((c) => {
      const match = allResults.find((r) => r.url === c.url);
      return this.calibrator.assess(c.title, match ? [match] : []);
    });

    const confidenceLevel = this.calibrator.assessOverall(assessments);

    let finalContent = answer.trim();

    // Append reference section if citations were extracted and not already appended
    if (citations.length > 0 && !finalContent.includes("### Sources") && !finalContent.includes("## References")) {
      finalContent += this.citations.buildReferenceSection(citations);
    }

    return {
      content: finalContent,
      citations,
      entitiesCovered,
      entitiesMissed,
      confidenceLevel,
    };
  }
}

export const answerBuilder = new AnswerBuilder();
