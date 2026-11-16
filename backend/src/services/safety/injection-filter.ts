export interface InjectionDetection {
  detected: boolean;
  patterns: string[];
  severity: "low" | "medium" | "high";
  originalContent: string;
  sanitizedContent: string;
}

const INJECTION_RULES = [
  {
    regex: /ignore\s+(?:all\s+|your\s+|previous\s+)*(?:instructions|prompts?|rules|guidelines)/gi,
    name: "ignore_instructions",
    severity: "high" as const,
    replacement: "[filtered: instruction override attempt]",
  },
  {
    regex: /you\s+are\s+now\s+(a\s+|an\s+)?/gi,
    name: "persona_override",
    severity: "medium" as const,
    replacement: "[filtered: persona override]",
  },
  {
    regex: /new\s+instructions?\s*:/gi,
    name: "new_instructions",
    severity: "high" as const,
    replacement: "[filtered: prompt injection]",
  },
  {
    regex: /system\s+prompt\s*:/gi,
    name: "system_prompt_spoof",
    severity: "high" as const,
    replacement: "[filtered: system directive spoof]",
  },
  {
    regex: /forget\s+(everything|all|your\s+rules|previous\s+instructions)/gi,
    name: "forget_rules",
    severity: "high" as const,
    replacement: "[filtered: memory wipe attempt]",
  },
  {
    regex: /act\s+as\s+(an?\s+unrestricted|a\s+different|dan|jailbreak)/gi,
    name: "jailbreak_act_as",
    severity: "high" as const,
    replacement: "[filtered: role override]",
  },
  {
    regex: /reveal\s+your\s+(internal\s+)?(prompt|instructions|system\s+message)/gi,
    name: "prompt_exfiltration",
    severity: "medium" as const,
    replacement: "[filtered: exfiltration attempt]",
  },
  {
    regex: /output\s+your\s+(system|initial)\s+(prompt|message)/gi,
    name: "output_prompt_exfiltration",
    severity: "medium" as const,
    replacement: "[filtered: exfiltration attempt]",
  },
  {
    regex: /```\s*system/gi,
    name: "system_markdown_fence",
    severity: "high" as const,
    replacement: "```",
  },
  {
    regex: /<\|system\|>|<\|im_(?:start|end)\|>|\[\/?INST\]/gi,
    name: "special_chat_tokens",
    severity: "high" as const,
    replacement: "",
  },
];

export class InjectionFilter {
  // Inspect text for suspicious prompt injection patterns
  detect(content: string): InjectionDetection {
    if (!content) {
      return {
        detected: false,
        patterns: [],
        severity: "low",
        originalContent: "",
        sanitizedContent: "",
      };
    }

    const matchedPatterns: string[] = [];
    let highestSeverity: "low" | "medium" | "high" = "low";

    for (const rule of INJECTION_RULES) {
      if (rule.regex.test(content)) {
        matchedPatterns.push(rule.name);
        if (rule.severity === "high") {
          highestSeverity = "high";
        } else if (rule.severity === "medium" && highestSeverity !== "high") {
          highestSeverity = "medium";
        }
      }
      // Reset state for global regex
      rule.regex.lastIndex = 0;
    }

    const sanitized = this.sanitize(content);

    return {
      detected: matchedPatterns.length > 0,
      patterns: matchedPatterns,
      severity: highestSeverity,
      originalContent: content,
      sanitizedContent: sanitized,
    };
  }

  // Neutralize prompt injection patterns from untrusted search snippets
  sanitize(content: string): string {
    if (!content) return "";
    let result = content;

    for (const rule of INJECTION_RULES) {
      result = result.replace(rule.regex, rule.replacement);
      rule.regex.lastIndex = 0;
    }

    return result.trim();
  }

  // Wrap search snippet in structured data tags to ensure the model parses it passively
  wrapAsData(content: string, sourceUrl?: string, publishedDate?: string): string {
    const sourceAttr = sourceUrl ? ` source="${sourceUrl}"` : "";
    const dateAttr = publishedDate ? ` date="${publishedDate}"` : "";
    return `<search_result${sourceAttr}${dateAttr}>\n${this.sanitize(content)}\n</search_result>`;
  }
}

export const injectionFilter = new InjectionFilter();
