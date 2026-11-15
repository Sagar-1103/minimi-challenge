import type { ProcessedSearchResult } from "../search/result-processor";

export type ConfidenceLevel = "high" | "medium" | "low" | "unverifiable";

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  reasoning: string;
  suggestion: string;
  badge: string;
}

export class ConfidenceCalibrator {
  // Assess verification confidence for a statement given retrieved evidence
  assess(claim: string, evidence: ProcessedSearchResult[]): ConfidenceAssessment {
    if (!evidence || evidence.length === 0) {
      return {
        level: "unverifiable",
        reasoning: "No relevant search results were retrieved for this claim.",
        suggestion: "State honestly that current information could not be found.",
        badge: "❌",
      };
    }

    const hasPrimarySource = evidence.some((e) => e.isPrimarySource && e.qualityScore >= 0.75);
    const hasRecentEvidence = evidence.some((e) => e.isAfterAnchor || (e.publishedDate && !e.publishedDate.startsWith("2024")));
    const isForumOrAggregator = evidence.every((e) =>
      /\b(reddit|quora|forum|community|news\.ycombinator|g2|capterra)\b/i.test(e.domain)
    );

    if (hasPrimarySource && hasRecentEvidence) {
      return {
        level: "high",
        reasoning: "Confirmed by official vendor documentation or primary source updated recently.",
        suggestion: "Present as verified fact backed by the primary source.",
        badge: "✅",
      };
    }

    if (hasPrimarySource && !hasRecentEvidence) {
      return {
        level: "high",
        reasoning: "Found on official vendor domain, though specific publication date was not stamped.",
        suggestion: "Present with reference to official documentation.",
        badge: "✅",
      };
    }

    if (isForumOrAggregator) {
      return {
        level: "low",
        reasoning: "Information is based solely on third-party forums or aggregator reviews without primary confirmation.",
        suggestion: "Note that this is based on community discussions and lacks official verification.",
        badge: "❓",
      };
    }

    // Default to medium confidence for general tech press and secondary sources
    return {
      level: "medium",
      reasoning: "Reported by secondary sources or tech news, but not directly confirmed on the vendor's site.",
      suggestion: "Cite the reporting source and note that official vendor confirmation is pending.",
      badge: "⚠️",
    };
  }

  // Derive the composite confidence level across all evaluated claims
  assessOverall(assessments: ConfidenceAssessment[]): ConfidenceLevel {
    if (assessments.length === 0) return "unverifiable";

    const hasLow = assessments.some((a) => a.level === "low");
    const hasUnverifiable = assessments.some((a) => a.level === "unverifiable");
    const allHigh = assessments.every((a) => a.level === "high");
    const mostlyHighOrMedium = assessments.every(
      (a) => a.level === "high" || a.level === "medium"
    );

    if (allHigh) return "high";
    if (mostlyHighOrMedium && !hasLow && !hasUnverifiable) return "medium";
    if (hasLow && !hasUnverifiable) return "low";
    return "unverifiable";
  }
}

export const confidenceCalibrator = new ConfidenceCalibrator();
