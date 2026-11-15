import type { ProcessedSearchResult } from "../search/result-processor";
import { SearchExecutor } from "../search/search-executor";
import { HistoryRetriever, historyRetriever, type HistoryMatch } from "./history-retriever";
import { ClaimExtractor, claimExtractor, type Claim } from "./claim-extractor";
import { DateResolver } from "../date-resolver";
import { llm, getActiveModel } from "../../lib/llm";
import { logger } from "../../utils/logger";

export interface VerificationResult {
  claim: Claim;
  status: "still_correct" | "outdated" | "cant_verify";
  currentValue?: string;
  evidence: ProcessedSearchResult[];
  explanation: string;
}

export interface ReVerificationReport {
  originalQuestion: string;
  originalAnswer: string;
  originalDate: Date;
  claims: VerificationResult[];
  summary: string;
  searchesPerformed: number;
}

export class ReVerifier {
  constructor(
    private retriever: HistoryRetriever = historyRetriever,
    private extractor: ClaimExtractor = claimExtractor,
    private searchExecutor: SearchExecutor = new SearchExecutor({
      maxConcurrency: 5,
      timeoutMs: 12000,
      maxTotalSearches: 15,
    })
  ) {}

  // Run the full verification flow: retrieve exchange, extract claims, search current status, and diff
  async verify(
    conversationId: string,
    dateExpression?: string,
    topic?: string,
    dateResolver?: DateResolver,
    excludeMessageId?: string
  ): Promise<ReVerificationReport | null> {
    const resolver = dateResolver || new DateResolver();
    const currentYear = resolver.getReferenceDate().getUTCFullYear();

    // 1. Locate matching history turns
    let matches: HistoryMatch[] = [];
    if (dateExpression && topic) {
      matches = await this.retriever.findByDateAndTopic(conversationId, dateExpression, topic, resolver, excludeMessageId);
    } else if (dateExpression) {
      matches = await this.retriever.findByDate(conversationId, dateExpression, resolver, excludeMessageId);
    } else if (topic) {
      matches = await this.retriever.findByTopic(conversationId, topic, excludeMessageId);
    }

    // Fall back to searching other conversations if not found in current session
    if (matches.length === 0) {
      matches = await this.retriever.findAcrossConversations(dateExpression, topic, resolver, excludeMessageId);
    }

    if (matches.length === 0) {
      return null;
    }

    const match = matches[0];
    const exchange = await this.retriever.getFullExchange(match.message.id);
    if (!exchange || !exchange.assistantResponse?.content) {
      return null;
    }

    const originalQuestion = exchange.userMessage.content || "";
    const originalAnswer = exchange.assistantResponse.content || "";
    const originalDate = exchange.timestamp;

    // 2. Extract verifiable claims
    const rawClaims = await this.extractor.extract(originalAnswer);
    const prioritizedClaims = this.extractor.prioritize(rawClaims).slice(0, 4);

    if (prioritizedClaims.length === 0) {
      return {
        originalQuestion,
        originalAnswer,
        originalDate,
        claims: [],
        summary: "No verifiable numerical or factual claims found in the previous answer.",
        searchesPerformed: 0,
      };
    }

    // 3. Generate verification search queries for current data
    const searchQueries: Array<{ id: string; query: string; entity?: string }> = [];
    for (const claim of prioritizedClaims) {
      const queries = this.extractor.generateVerificationQueries(claim, currentYear);
      for (const q of queries) {
        searchQueries.push({
          id: `${claim.id}_${searchQueries.length}`,
          query: q,
          entity: claim.entity,
        });
      }
    }

    // 4. Run parallel web searches
    const searchResultsMap = await this.searchExecutor.executeParallel(
      searchQueries,
      originalDate
    );

    // 5. Verify each claim against the retrieved search results
    const verificationResults: VerificationResult[] = [];
    for (const claim of prioritizedClaims) {
      const claimResults: ProcessedSearchResult[] = [];
      for (const sq of searchQueries) {
        if (sq.id.startsWith(claim.id)) {
          const execRes = searchResultsMap.get(sq.id);
          if (execRes?.results) {
            claimResults.push(...execRes.results);
          }
        }
      }

      const result = await this.verifyClaim(claim, claimResults);
      verificationResults.push(result);
    }

    // 6. Aggregate report summary
    const stillCorrect = verificationResults.filter((r) => r.status === "still_correct").length;
    const outdated = verificationResults.filter((r) => r.status === "outdated").length;
    const cantVerify = verificationResults.filter((r) => r.status === "cant_verify").length;
    const total = verificationResults.length;

    const summary = `${stillCorrect} of ${total} claims still correct; ${outdated} outdated; ${cantVerify} unverifiable.`;

    return {
      originalQuestion,
      originalAnswer,
      originalDate,
      claims: verificationResults,
      summary,
      searchesPerformed: searchQueries.length,
    };
  }

  // Compare a single factual claim against retrieved search evidence
  async verifyClaim(
    claim: Claim,
    searchResults: ProcessedSearchResult[]
  ): Promise<VerificationResult> {
    if (searchResults.length === 0) {
      return {
        claim,
        status: "cant_verify",
        evidence: [],
        explanation: "No relevant search results were retrieved to verify this claim.",
      };
    }

    const topEvidence = searchResults.slice(0, 3);
    const snippets = topEvidence.map((e) => `[${e.domain}]: ${e.content}`).join("\n\n");

    try {
      const activeModel = getActiveModel();
      const response = await llm.chat.completions.create(
        {
          model: activeModel,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: `You are a strict factual verification judge. Compare a previously claimed value or statement against current search snippets.
Determine whether the claim is:
- "still_correct": Search results corroborate the original claim or value.
- "outdated": Current evidence shows the value or feature has changed. State the new currentValue if identifiable.
- "cant_verify": The snippets are contradictory, unclear, or don't explicitly mention the metric.

Output valid JSON ONLY:
{
  "status": "still_correct" | "outdated" | "cant_verify",
  "currentValue": "string (new value if outdated)",
  "explanation": "concise 1-sentence reason"
}`,
            },
            {
              role: "user",
              content: `Claim to verify:
Statement: "${claim.statement}"
Entity: "${claim.entity || "N/A"}"
Original Value: "${claim.originalValue || "N/A"}"

Current Search Evidence:
${snippets}`,
            },
          ],
        },
        { signal: AbortSignal.timeout(12000) }
      );

      const raw = response.choices[0]?.message?.content?.trim() || "";
      const cleanedJson = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleanedJson);

      if (parsed.status && ["still_correct", "outdated", "cant_verify"].includes(parsed.status)) {
        return {
          claim,
          status: parsed.status,
          currentValue: parsed.currentValue,
          evidence: topEvidence,
          explanation: parsed.explanation || "Verified against current search sources.",
        };
      }
    } catch (err: any) {
      logger.warn(`LLM claim verification failed, using heuristic evaluation: ${err.message}`);
    }

    return this.heuristicVerify(claim, topEvidence);
  }

  // Heuristic verification fallback
  public heuristicVerify(
    claim: Claim,
    evidence: ProcessedSearchResult[]
  ): VerificationResult {
    const combinedText = evidence.map((e) => `${e.title} ${e.content}`).join(" ");

    // Check if the original value is explicitly found in current snippets
    if (claim.originalValue && combinedText.toLowerCase().includes(claim.originalValue.toLowerCase())) {
      return {
        claim,
        status: "still_correct",
        evidence,
        explanation: `Original value "${claim.originalValue}" found in current search results.`,
      };
    }

    // Look for potential changes in price or quota
    if (claim.originalValue && /\$\d+/.test(claim.originalValue)) {
      const priceMatches = combinedText.match(/\$\d+(?:\.\d+)?/g);
      if (priceMatches && priceMatches.length > 0) {
        const foundPrice = priceMatches[0];
        if (foundPrice.toLowerCase() !== claim.originalValue.toLowerCase()) {
          return {
            claim,
            status: "outdated",
            currentValue: foundPrice,
            evidence,
            explanation: `Found updated price ${foundPrice} in search results.`,
          };
        }
      }
    }

    return {
      claim,
      status: "cant_verify",
      evidence,
      explanation: `Could not definitively confirm "${claim.statement}" in the search snippets.`,
    };
  }

  // Format a completed verification report for presentation to the LLM or user
  formatReportForLLM(report: ReVerificationReport): string {
    const lines: string[] = [
      "### Conversation Recall & Factual Re-Verification",
      `- **Original Question Asked**: "${report.originalQuestion}"`,
      `- **Date of Original Answer**: ${report.originalDate.toISOString().split("T")[0]}`,
      `- **Verification Summary**: ${report.summary}`,
      "",
      "#### Claims Evaluated:",
    ];

    for (const [idx, item] of report.claims.entries()) {
      const verdict = item.status.toUpperCase().replace("_", " ");
      const updateStr = item.currentValue ? ` (Now: ${item.currentValue})` : "";
      lines.push(`${idx + 1}. **[${item.claim.entity || "Fact"}]** "${item.claim.statement}"`);
      lines.push(`   - **Status**: ${verdict}${updateStr}`);
      lines.push(`   - **Reason**: ${item.explanation}`);

      if (item.evidence.length > 0) {
        lines.push(`   - **Source**: ${item.evidence[0].url}`);
      }
    }

    return lines.join("\n");
  }
}

export const reVerifier = new ReVerifier();
