import type { TavilySearchResult } from "../../lib/tavily";

export class SourceEvaluator {
  // Checks if a URL dynamically matches the target entity or points to an official subdomain
  public isPrimarySource(url: string, entity?: string): boolean {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

      // Match official subdomains (docs, changelog, blog, status, api)
      if (/^(docs|blog|changelog|status|api|help|support)\./.test(hostname)) {
        return true;
      }

      if (entity) {
        // Strip non-alphanumeric characters for clean comparison (e.g. "Node.js" -> "nodejs")
        const cleanEntity = entity.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cleanEntity.length >= 3 && hostname.includes(cleanEntity)) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  // Calculate recency factor based on publication date and optional anchor date
  public calculateRecencyScore(publishedDateStr?: string, anchorDate?: Date): number {
    if (!publishedDateStr) {
      return 0.3; // Default score for unversioned/undated web pages
    }

    const pubDate = new Date(publishedDateStr);
    if (isNaN(pubDate.getTime())) {
      return 0.3;
    }

    const now = Date.now();
    const daysOld = Math.max(0, (now - pubDate.getTime()) / (1000 * 60 * 60 * 24));

    // If an anchor date is provided and the source was published after it, boost it
    if (anchorDate && pubDate.getTime() >= anchorDate.getTime()) {
      return 1.0;
    }

    if (daysOld <= 7) return 0.9;
    if (daysOld <= 30) return 0.7;
    if (daysOld <= 90) return 0.5;
    return 0.2;
  }

  // Normalized composite score from 0.0 to 1.0
  public scoreSource(
    result: TavilySearchResult,
    entity?: string,
    anchorDate?: Date
  ): number {
    const relevance = typeof result.score === "number" ? Math.min(Math.max(result.score, 0), 1) : 0.6;
    const isPrimary = this.isPrimarySource(result.url, entity);
    const recency = this.calculateRecencyScore(result.publishedDate, anchorDate);

    const primaryWeight = isPrimary ? 0.3 : 0.1;
    const score = relevance * 0.4 + primaryWeight + recency * 0.3;

    return Math.round(score * 100) / 100;
  }
}

export const sourceEvaluator = new SourceEvaluator();
