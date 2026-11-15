import type { Citation } from "./citation-engine";
import type { VerificationResult } from "../memory/re-verifier";

export interface EntityComparison {
  name: string;
  values: Record<string, string>;
  sources: Citation[];
}

export interface EntityChangeReport {
  name: string;
  status: "changed" | "no_change_found" | "unverified";
  changes: Array<{
    aspect: string;
    status: "changed" | "no_change_found" | "unverified";
    detail?: string;
  }>;
  sources: Citation[];
}

export class TableFormatter {
  // Format side-by-side comparison matrix across entities and features
  formatComparisonTable(entities: EntityComparison[], columns: string[]): string {
    if (entities.length === 0 || columns.length === 0) return "";

    const headers = ["Entity", ...columns, "Sources"];
    const separator = headers.map(() => "---");

    const rows: string[] = [
      `| ${headers.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
    ];

    for (const entity of entities) {
      const colValues = columns.map((col) => entity.values[col] || "—");
      const sourcesStr =
        entity.sources.length > 0
          ? entity.sources.map((s) => `[${s.title}](${s.url})`).join(", ")
          : "—";

      rows.push(`| **${entity.name}** | ${colValues.join(" | ")} | ${sourcesStr} |`);
    }

    return rows.join("\n");
  }

  // Generate a change-detection summary table clearly separating confirmed updates from unchanged entities
  formatChangeTable(entities: EntityChangeReport[]): string {
    if (entities.length === 0) return "";

    const changedCount = entities.filter((e) => e.status === "changed").length;
    const total = entities.length;

    const headline = `**${changedCount} of ${total} tools have changes:**\n\n`;

    const headers = ["Tool", "Status", "Notable Updates", "Sources"];
    const separator = ["---", "---", "---", "---"];

    const rows: string[] = [
      headline + `| ${headers.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
    ];

    for (const e of entities) {
      let statusBadge = "✅ No change found";
      if (e.status === "changed") {
        statusBadge = "⚠️ Changed";
      } else if (e.status === "unverified") {
        statusBadge = "❓ Couldn't verify";
      }

      const updatesText =
        e.changes.length > 0
          ? e.changes
              .map((c) => (c.detail ? `${c.aspect}: ${c.detail}` : c.aspect))
              .join("; ")
          : e.status === "no_change_found"
          ? "No changes detected in recent announcements"
          : "Insufficient information in search results";

      const sourcesText =
        e.sources.length > 0
          ? e.sources.map((s) => `[${s.title}](${s.url})`).join(", ")
          : "—";

      rows.push(`| **${e.name}** | ${statusBadge} | ${updatesText} | ${sourcesText} |`);
    }

    return rows.join("\n");
  }

  // Format historical re-verification results into a structured verification table
  formatVerificationTable(results: VerificationResult[]): string {
    if (results.length === 0) return "";

    const headers = ["Entity / Claim", "Status", "Current Value", "Reason / Evidence"];
    const separator = ["---", "---", "---", "---"];

    const rows: string[] = [
      `| ${headers.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
    ];

    for (const r of results) {
      let statusBadge = "✅ Still Correct";
      if (r.status === "outdated") {
        statusBadge = "⚠️ Outdated";
      } else if (r.status === "cant_verify") {
        statusBadge = "❓ Couldn't Verify";
      }

      const entityOrClaim = r.claim.entity
        ? `**${r.claim.entity}** (${r.claim.statement})`
        : r.claim.statement;

      const currentValue = r.currentValue || r.claim.originalValue || "—";
      const evidence = r.explanation || (r.evidence[0] ? `[${r.evidence[0].domain}](${r.evidence[0].url})` : "—");

      rows.push(`| ${entityOrClaim} | ${statusBadge} | ${currentValue} | ${evidence} |`);
    }

    return rows.join("\n");
  }
}

export const tableFormatter = new TableFormatter();
