export class PromptProtection {
  private extractionPatterns = [
    /\b(?:what\s+is|show\s+me|print|output|display|reveal|share|give\s+me)\s+(?:your\s+)?(?:system\s+prompt|developer\s+instructions?|system\s+instructions?|hidden\s+prompt|initial\s+prompt|meta\s+prompt)\b/i,
    /\b(?:repeat|recite|print|output)\s+(?:everything|all\s+the\s+text)\s+(?:above|before\s+this|prior\s+to\s+this)\b/i,
    /\bwhat\s+(?:were\s+you|are\s+you)\s+(?:told|instructed|configured)\s+to\s+do\b/i,
    /\bignore\s+(?:all\s+|your\s+|previous\s+)?instructions\s+and\s+(?:tell|show|reveal|output)\b/i,
    /\b(?:tell\s+me|what\s+are)\s+your\s+(?:rules|guidelines|hidden\s+directives|guardrails)\b/i,
  ];

  // Identify attempts by the user to extract or bypass the agent's internal system instructions
  detectSystemPromptExtraction(message: string): boolean {
    if (!message || typeof message !== "string") return false;
    const clean = message.trim();

    return this.extractionPatterns.some((pattern) => pattern.test(clean));
  }

  // Consistent, polite refusal message that prevents instruction leakage
  getRefusalResponse(): string {
    return "I can't share my internal configuration or instructions, but I'm happy to help you with your question!";
  }
}

export const promptProtection = new PromptProtection();
