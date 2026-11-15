import type { ProcessedSearchResult } from "../search/result-processor";

export interface Citation {
  index: number;
  title: string;
  url: string;
  domain: string;
  publishedDate?: string;
  accessedDate: string;
  isPrimarySource?: boolean;
}

export class CitationEngine {
  // Format a single search result as an inline markdown citation
  formatInlineCitation(result: ProcessedSearchResult, index?: number): string {
    const label = index ? `[${index}]` : `[${result.title || result.domain}]`;
    const dateStr = result.publishedDate ? ` (${result.publishedDate})` : "";
    return `${label}(${result.url})${dateStr}`;
  }

  // Construct a formatted reference list for the footer of an answer
  buildReferenceSection(citations: Citation[]): string {
    if (citations.length === 0) return "";

    const lines: string[] = ["\n\n### Sources"];
    for (const c of citations) {
      const datePart = c.publishedDate
        ? `Published ${c.publishedDate}`
        : `Accessed ${c.accessedDate}`;
      const badge = c.isPrimarySource ? " [Official Source]" : "";
      lines.push(`${c.index}. [${c.title}](${c.url}) - ${c.domain} (${datePart})${badge}`);
    }

    return lines.join("\n");
  }

  // Scan answer content and match against available search results to extract active citations
  extractCitations(
    text: string,
    availableResults: ProcessedSearchResult[],
    todayDate: Date = new Date()
  ): Citation[] {
    const todayStr = todayDate.toISOString().split("T")[0];
    const citations: Citation[] = [];
    const seenUrls = new Set<string>();

    let idx = 1;

    for (const res of availableResults) {
      if (!res.url || seenUrls.has(res.url)) continue;

      // Check if URL or domain is cited in the markdown text
      const urlEscaped = res.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const domainEscaped = res.domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const hasUrl = new RegExp(urlEscaped, "i").test(text);
      const hasDomainLink = new RegExp(`\\[[^\\]]+\\]\\([^)]*${domainEscaped}[^)]*\\)`, "i").test(text);

      if (hasUrl || hasDomainLink) {
        seenUrls.add(res.url);
        citations.push({
          index: idx++,
          title: res.title || res.domain,
          url: res.url,
          domain: res.domain,
          publishedDate: res.publishedDate,
          accessedDate: todayStr,
          isPrimarySource: res.isPrimarySource,
        });
      }
    }

    // Fall back to top primary or high-quality search results if no markdown links were generated
    if (citations.length === 0 && availableResults.length > 0) {
      const topResults = availableResults.slice(0, 4);
      for (const res of topResults) {
        if (!seenUrls.has(res.url)) {
          seenUrls.add(res.url);
          citations.push({
            index: idx++,
            title: res.title || res.domain,
            url: res.url,
            domain: res.domain,
            publishedDate: res.publishedDate,
            accessedDate: todayStr,
            isPrimarySource: res.isPrimarySource,
          });
        }
      }
    }

    return citations;
  }

  // Guidelines for the LLM on inline citation requirements
  getCitationInstructions(): string {
    return [
      "CITATION REQUIREMENTS:",
      "- Every time-sensitive fact or metric (pricing, limits, releases) MUST include an inline citation in markdown: [Source Title](URL).",
      "- If the source provides a publication or last-modified date, note it in parentheses, e.g. ([HubSpot Pricing](https://hubspot.com/pricing), Nov 2026).",
      "- Cite official vendor domains and primary documentation as authoritative sources.",
    ].join("\n");
  }
}

export const citationEngine = new CitationEngine();
