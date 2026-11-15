export interface SafetyCheck {
  safe: boolean;
  reason?: string;
  category?: "harmful" | "illegal" | "privacy" | "other";
}

const HARMFUL_PATTERNS = [
  {
    regex: /\b(how\s+to\s+build|synthesize|manufacture)\s+(a\s+bomb|explosives?|chemical\s+weapons?|bioweapons?)\b/i,
    category: "harmful" as const,
    reason: "Requests relating to dangerous weapons or explosives are prohibited.",
  },
  {
    regex: /\b(how\s+to\s+hack|exploit\s+vulnerability|ddos\s+attack|create\s+ransomware|keylogger\s+script)\b/i,
    category: "illegal" as const,
    reason: "Instructions for malicious cyber attacks or malware generation are prohibited.",
  },
  {
    regex: /\b(leak\s+passwords?|stolen\s+credit\s+cards?|ssn\s+database|doxx?ing)\b/i,
    category: "privacy" as const,
    reason: "Requests targeting personally identifiable information or stolen credentials are prohibited.",
  },
  {
    regex: /\b(how\s+to\s+commit\s+suicide|self-harm\s+methods)\b/i,
    category: "harmful" as const,
    reason: "Content promoting self-harm or suicide is strictly prohibited.",
  },
];

export class ContentFilter {
  // Validate user message against standard safety guardrails
  checkUserMessage(message: string): SafetyCheck {
    if (!message || typeof message !== "string") {
      return { safe: true };
    }

    const clean = message.trim();

    for (const rule of HARMFUL_PATTERNS) {
      if (rule.regex.test(clean)) {
        return {
          safe: false,
          category: rule.category,
          reason: rule.reason,
        };
      }
    }

    return { safe: true };
  }

  // Ensure generated search queries don't violate safety policies
  checkSearchQuery(query: string): SafetyCheck {
    return this.checkUserMessage(query);
  }
}

export const contentFilter = new ContentFilter();
