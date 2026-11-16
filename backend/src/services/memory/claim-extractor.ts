import { llm, getActiveModel } from "../../lib/llm";
import { logger } from "../../utils/logger";

export interface Claim {
  id: string;
  statement: string;
  entity?: string;
  subjectArea?: string;
  originalValue?: string;
  sourceUrl?: string;
  isVerifiable: boolean;
}

export class ClaimExtractor {
  // Extract verifiable factual claims from an assistant message
  async extract(assistantMessage: string): Promise<Claim[]> {
    if (!assistantMessage || !assistantMessage.trim()) {
      return [];
    }

    try {
      const activeModel = getActiveModel();
      const response = await llm.chat.completions.create(
        {
          model: activeModel,
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: `You are an expert factual claim extraction system.
Analyze the provided assistant response from a past conversation and extract all verifiable factual claims (pricing, storage limits, quotas, versions, plans, features, or numerical specifications).
Do not extract subjective opinions or advice unless they hinge on a testable fact.

Output MUST be a valid JSON array of objects with this schema:
[
  {
    "statement": "string (the exact factual claim made)",
    "entity": "string (product, service, company, or subject, e.g. 'Neon', 'Supabase', 'Postgres')",
    "subjectArea": "string (e.g. 'pricing', 'storage limit', 'features', 'version')",
    "originalValue": "string (specific claimed metric or value, e.g. '0.5 GB', '$19/mo', 'v15.2')",
    "isVerifiable": true
  }
]
Return ONLY the raw JSON array, with no markdown code fences and no extra conversational text.`,
            },
            {
              role: "user",
              content: assistantMessage,
            },
          ],
        },
        { signal: AbortSignal.timeout(15000) }
      );

      const rawContent = response.choices[0]?.message?.content?.trim() || "";
      const cleanedJson = rawContent
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const parsed = JSON.parse(cleanedJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => ({
          id: `claim_${Date.now()}_${idx}`,
          statement: String(item.statement || "").trim(),
          entity: item.entity ? String(item.entity).trim() : undefined,
          subjectArea: item.subjectArea ? String(item.subjectArea).trim() : undefined,
          originalValue: item.originalValue ? String(item.originalValue).trim() : undefined,
          sourceUrl: item.sourceUrl ? String(item.sourceUrl).trim() : undefined,
          isVerifiable: item.isVerifiable !== false,
        }));
      }
    } catch (err: any) {
      logger.warn(`LLM claim extraction failed, falling back to deterministic extraction: ${err.message}`);
    }

    return this.fallbackExtract(assistantMessage);
  }

  // Deterministic rule-based extraction fallback for resilience
  public fallbackExtract(text: string): Claim[] {
    const claims: Claim[] = [];
    if (!text) return claims;

    const lines = text
      .split(/\n+/)
      .map((l) => l.replace(/^[-*•\d.]+\s*/, "").trim())
      .filter((l) => l.length > 10);

    let claimIdx = 0;

    for (const line of lines) {
      // Look for pricing, limits, numbers, or specific metrics (prioritizing quantitative values over generic terms)
      const quantMatch = line.match(
        /(\$\d+(?:\.\d+)?(?:\/(?:mo|month|yr|year|user))?|\d+(?:\.\d+)?\s*(?:gb|mb|tb|core|cpu|ram|projects?|users?|members?|days?|queries|tokens?)|v\d+(?:\.\d+)?)/i
      );
      const valueMatch = quantMatch || line.match(/(free\s+tier|open-source)/i);

      // Look for capitalized brand or product entity at word boundaries
      const entityMatch = line.match(/\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)?)\b/);

      if (valueMatch) {
        const value = valueMatch[0];
        const entity = entityMatch ? entityMatch[1] : undefined;

        let subjectArea = "feature";
        if (/\$|free\s+tier|cost|price|pricing|month/i.test(line)) {
          subjectArea = "pricing";
        } else if (/storage|gb|mb|tb|compute|ram|cpu/i.test(line)) {
          subjectArea = "storage limit";
        } else if (/version|v\d+/i.test(line)) {
          subjectArea = "version";
        }

        claims.push({
          id: `claim_fb_${Date.now()}_${claimIdx++}`,
          statement: line,
          entity,
          subjectArea,
          originalValue: value,
          isVerifiable: true,
        });
      }
    }

    return claims;
  }

  // Rank verifiable, high-specificity claims ahead of generic descriptions
  prioritize(claims: Claim[]): Claim[] {
    return [...claims].sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;

      if (a.isVerifiable) scoreA += 4;
      if (b.isVerifiable) scoreB += 4;

      if (a.originalValue) scoreA += 3;
      if (b.originalValue) scoreB += 3;

      if (a.entity) scoreA += 2;
      if (b.entity) scoreB += 2;

      // Quantitative values (numbers and currency) get higher priority
      if (a.originalValue && /[\$\d]/.test(a.originalValue)) scoreA += 2;
      if (b.originalValue && /[\$\d]/.test(b.originalValue)) scoreB += 2;

      return scoreB - scoreA;
    });
  }

  // Generate targeted web search queries to verify whether the claim is still accurate
  generateVerificationQueries(claim: Claim, currentYear: number): string[] {
    const queries: string[] = [];

    const entity = claim.entity ? claim.entity.replace(/['"]/g, "").trim() : "";
    const subject = claim.subjectArea ? claim.subjectArea.trim() : "";
    const value = claim.originalValue ? claim.originalValue.replace(/['"]/g, "").trim() : "";

    if (entity && subject) {
      queries.push(`${entity} ${subject} ${currentYear}`.trim());
    }

    if (entity && value && !queries.some((q) => q.includes(value))) {
      queries.push(`${entity} ${value} ${currentYear}`.trim());
    }

    if (queries.length === 0) {
      if (entity) {
        queries.push(`${entity} pricing plans limits ${currentYear}`.trim());
      } else {
        const words = claim.statement
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 2)
          .slice(0, 5)
          .join(" ");
        queries.push(`${words} ${currentYear}`.trim());
      }
    }

    // Clean whitespace and remove duplicate queries
    return Array.from(new Set(queries.map((q) => q.replace(/\s+/g, " ").trim())));
  }
}

export const claimExtractor = new ClaimExtractor();
