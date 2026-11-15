import type { Claim } from "../memory/claim-extractor";
import type { ProcessedSearchResult } from "../search/result-processor";
import type { Citation } from "./citation-engine";

export interface DiffItem {
  entity: string;
  field: string;
  oldValue?: string;
  newValue?: string;
  changeDate?: string;
  source?: Citation;
}

export interface DiffReport {
  headline: string;
  changes: DiffItem[];
  noChanges: DiffItem[];
  unverified: DiffItem[];
}

export class DiffReporter {
  // Compare historical claims against current search results to produce a structured diff
  generateDiff(
    oldClaims: Claim[],
    currentResults: Map<string, ProcessedSearchResult[]>,
    anchorDate?: Date
  ): DiffReport {
    const changes: DiffItem[] = [];
    const noChanges: DiffItem[] = [];
    const unverified: DiffItem[] = [];

    for (const claim of oldClaims) {
      const entity = claim.entity || "General";
      const field = claim.subjectArea || "feature";

      // Look up search results by entity name or fallback to all results
      let evidence = currentResults.get(entity) || [];
      if (evidence.length === 0) {
        for (const [key, resList] of currentResults.entries()) {
          if (key.toLowerCase().includes(entity.toLowerCase())) {
            evidence = resList;
            break;
          }
        }
      }

      if (evidence.length === 0) {
        unverified.push({
          entity,
          field,
          oldValue: claim.originalValue,
        });
        continue;
      }

      const topEvidence = evidence[0];
      const combinedText = evidence.map((e) => `${e.title} ${e.content}`).join(" ");

      const citation: Citation = {
        index: 1,
        title: topEvidence.title,
        url: topEvidence.url,
        domain: topEvidence.domain,
        publishedDate: topEvidence.publishedDate,
        accessedDate: new Date().toISOString().split("T")[0],
        isPrimarySource: topEvidence.isPrimarySource,
      };

      // Check if original price or metric has changed
      if (claim.originalValue && /\$\d+/.test(claim.originalValue)) {
        const pricesFound = combinedText.match(/\$\d+(?:\.\d+)?/g);
        if (pricesFound && pricesFound.length > 0) {
          const newPrice = pricesFound[0];
          if (newPrice.toLowerCase() !== claim.originalValue.toLowerCase()) {
            changes.push({
              entity,
              field,
              oldValue: claim.originalValue,
              newValue: newPrice,
              changeDate: topEvidence.publishedDate,
              source: citation,
            });
            continue;
          }
        }
      }

      // Check if original value is confirmed
      if (
        claim.originalValue &&
        combinedText.toLowerCase().includes(claim.originalValue.toLowerCase())
      ) {
        noChanges.push({
          entity,
          field,
          oldValue: claim.originalValue,
          source: citation,
        });
      } else {
        unverified.push({
          entity,
          field,
          oldValue: claim.originalValue,
          source: citation,
        });
      }
    }

    const total = changes.length + noChanges.length + unverified.length;
    const headline =
      total > 0
        ? `${changes.length} of ${total} items have changed${
            anchorDate ? ` since ${anchorDate.toISOString().split("T")[0]}` : ""
          }:`
        : "No verifiable changes detected.";

    return {
      headline,
      changes,
      noChanges,
      unverified,
    };
  }

  // Format the structured diff report into clean human-readable markdown
  formatDiff(report: DiffReport): string {
    const lines: string[] = [`**${report.headline}**\n`];

    if (report.changes.length > 0) {
      lines.push("### ⚠️ Confirmed Changes");
      for (const c of report.changes) {
        const sourceStr = c.source ? ` ([${c.source.title}](${c.source.url}))` : "";
        const fromStr = c.oldValue ? `was ${c.oldValue}` : "previously unlisted";
        const toStr = c.newValue ? `now **${c.newValue}**` : "updated";
        lines.push(`- **${c.entity}** (${c.field}): ${toStr} (${fromStr})${sourceStr}`);
      }
      lines.push("");
    }

    if (report.noChanges.length > 0) {
      lines.push("### ✅ No Changes Detected");
      for (const nc of report.noChanges) {
        const sourceStr = nc.source ? ` ([${nc.source.title}](${nc.source.url}))` : "";
        const valStr = nc.oldValue ? ` (${nc.oldValue})` : "";
        lines.push(`- **${nc.entity}**: Confirmed unchanged${valStr}${sourceStr}`);
      }
      lines.push("");
    }

    if (report.unverified.length > 0) {
      lines.push("### ❓ Unverified Items");
      for (const uv of report.unverified) {
        lines.push(`- **${uv.entity}**: Current data could not be verified in search results.`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

export const diffReporter = new DiffReporter();
