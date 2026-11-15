import type { TavilySearchResult } from "../../lib/tavily";
import { SourceEvaluator, sourceEvaluator } from "./source-evaluator";

export interface ProcessedSearchResult {
  title: string;
  url: string;
  domain: string;
  content: string;
  score: number;
  qualityScore: number;
  publishedDate?: string;
  isAfterAnchor: boolean;
  isPrimarySource: boolean;
}

export interface ResultProcessingContext {
  anchorDate?: Date;
  entity?: string;
  query?: string;
  maxResults?: number;
  maxCharsPerSnippet?: number;
}

export class ResultProcessor {
  constructor(private evaluator: SourceEvaluator = sourceEvaluator) {}

  private extractDomain(urlStr: string): string {
    try {
      return new URL(urlStr).hostname.replace(/^www\./, "");
    } catch {
      return urlStr;
    }
  }

  // Filter, score, and rank search results
  public process(
    results: TavilySearchResult[],
    context: ResultProcessingContext = {}
  ): ProcessedSearchResult[] {
    const { anchorDate, entity, maxResults = 8 } = context;

    const deduplicated = this.deduplicate(results);

    const processed: ProcessedSearchResult[] = deduplicated.map((r) => {
      const isPrimary = this.evaluator.isPrimarySource(r.url, entity);
      const qualityScore = this.evaluator.scoreSource(r, entity, anchorDate);

      let isAfterAnchor = false;
      if (anchorDate && r.publishedDate) {
        const pubDate = new Date(r.publishedDate);
        if (!isNaN(pubDate.getTime()) && pubDate.getTime() >= anchorDate.getTime()) {
          isAfterAnchor = true;
        }
      }

      return {
        title: r.title || r.url,
        url: r.url,
        domain: this.extractDomain(r.url),
        content: this.cleanContent(r.content || ""),
        score: typeof r.score === "number" ? r.score : 0.5,
        qualityScore,
        publishedDate: r.publishedDate,
        isAfterAnchor,
        isPrimarySource: isPrimary,
      };
    });

    // Rank by qualityScore descending
    processed.sort((a, b) => b.qualityScore - a.qualityScore);

    return processed.slice(0, maxResults);
  }

  // Clean HTML artifacts and truncate snippets to prevent context window bloat
  public cleanContent(text: string, maxChars = 750): string {
    if (!text) return "";

    const cleaned = text
      .replace(/\s+/g, " ")
      .replace(/[\r\n\t]+/g, " ")
      .trim();

    if (cleaned.length <= maxChars) {
      return cleaned;
    }

    return `${cleaned.slice(0, maxChars)}...`;
  }

  // Deduplicate results by URL
  public deduplicate<T extends { url: string }>(results: T[]): T[] {
    const seen = new Set<string>();
    const unique: T[] = [];

    for (const item of results) {
      if (!item.url) continue;
      const key = item.url.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }

    return unique;
  }

  // Format ranked results for the LLM tool response
  public formatForLLM(results: ProcessedSearchResult[]): string {
    if (results.length === 0) {
      return "No relevant search results found.";
    }

    return results
      .map((r, index) => {
        const badges: string[] = [];
        if (r.isPrimarySource) badges.push("Primary Source");
        if (r.isAfterAnchor) badges.push("Updated After Anchor Date");

        const badgeStr = badges.length > 0 ? ` [${badges.join(" | ")}]` : "";
        const dateStr = r.publishedDate ? ` | Published: ${r.publishedDate}` : "";

        return `### Result ${index + 1}: ${r.title}${badgeStr}\n- **URL**: ${r.url}\n- **Domain**: ${r.domain}${dateStr}\n- **Snippet**: ${r.content}\n`;
      })
      .join("\n");
  }
}

export const resultProcessor = new ResultProcessor();
