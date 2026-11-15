import type { ProcessedSearchResult } from "../search/result-processor";

export interface ResponseMetadata {
  sourcesChecked: number;
  durationMs?: number;
  anchorDate?: Date;
}

export class ResponseFormatter {
  // Ensure markdown formatting is well-formed (closing unclosed code fences, normalizing spacing)
  cleanMarkdown(text: string): string {
    if (!text) return "";

    let cleaned = text.trim();

    // Fix unclosed code fences
    const fenceMatches = cleaned.match(/```/g);
    if (fenceMatches && fenceMatches.length % 2 !== 0) {
      cleaned += "\n```";
    }

    // Normalize excessive consecutive blank lines
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

    return cleaned;
  }

  // Ensure citation links in text are well-structured
  cleanCitations(text: string, _sources: ProcessedSearchResult[]): string {
    if (!text) return "";

    // Replace empty link labels `[](url)` with domain or source label
    return text.replace(/\[\s*\]\((https?:\/\/[^\s)]+)\)/g, (_match, url) => {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, "");
        return `[${domain}](${url})`;
      } catch {
        return `[Source](${url})`;
      }
    });
  }

  // Append a concise metadata line summarizing verification breadth
  addMetadata(text: string, metadata: ResponseMetadata): string {
    if (!text || metadata.sourcesChecked <= 0) return text;
    if (text.includes("### Sources Checked") || text.includes("*Sources evaluated:")) {
      return text;
    }

    const durationStr = metadata.durationMs
      ? ` in ${(metadata.durationMs / 1000).toFixed(1)}s`
      : "";

    return `${text}\n\n---\n*Evaluated across ${metadata.sourcesChecked} web sources${durationStr}*`;
  }
}

export const responseFormatter = new ResponseFormatter();
