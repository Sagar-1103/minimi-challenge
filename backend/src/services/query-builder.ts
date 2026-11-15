export class QueryBuilder {
  private currentYear: number;
  private anchorDate?: Date;

  constructor(referenceDate?: Date, anchorDate?: Date) {
    const ref = referenceDate ? new Date(referenceDate) : new Date();
    this.currentYear = ref.getUTCFullYear();
    this.anchorDate = anchorDate ? new Date(anchorDate) : undefined;
  }

  public getCurrentYear(): number {
    return this.currentYear;
  }

  // Swap out stale years that leak from LLM training data (e.g. 2022 -> 2026)
  public modernizeStaleYears(query: string): string {
    const trimmed = query.trim();
    const yearMatch = trimmed.match(/\b(19\d{2}|20\d{2})\b/);

    if (yearMatch) {
      const foundYear = parseInt(yearMatch[1], 10);
      if (foundYear < this.currentYear - 1) {
        return trimmed.replace(yearMatch[0], String(this.currentYear));
      }
    }

    return trimmed;
  }

  // Narrow searches to changes that occurred after the referenced anchor date
  public addTemporalFilter(query: string): string {
    if (!this.anchorDate) {
      return query;
    }

    const month = this.anchorDate.toLocaleDateString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    const year = this.anchorDate.getUTCFullYear();

    return `${query} since ${month} ${year}`.trim();
  }

  // Pre-process LLM tool queries before hitting Tavily
  public enrichQuery(query: string): string {
    return this.modernizeStaleYears(query);
  }
}
