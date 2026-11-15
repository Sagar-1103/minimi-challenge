export interface DateResolution {
  resolvedDate: Date;
  originalExpression: string;
  confidence: "exact" | "inferred";
  assumption?: string;
  formatted: string;
}

export interface ExtractedDateExpression {
  expression: string;
  startIndex: number;
  endIndex: number;
}

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MONTH_NAMES: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

export class DateResolver {
  private referenceDate: Date;

  constructor(referenceDate?: Date) {
    this.referenceDate = referenceDate ? new Date(referenceDate) : new Date();
  }

  public getReferenceDate(): Date {
    return new Date(this.referenceDate);
  }

  // Consistent display format for final answers, e.g. "Tuesday 3 Nov 2026"
  public formatForDisplay(date: Date): string {
    const dayName = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    const day = date.getUTCDate();
    const month = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const year = date.getUTCFullYear();
    return `${dayName} ${day} ${month} ${year}`;
  }

  public formatForSearch(date: Date): string {
    const month = date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    const year = date.getUTCFullYear();
    return `${month} ${year}`;
  }

  // Pull out date-like tokens from natural speech using pattern matching
  public extractDateExpressions(text: string): ExtractedDateExpression[] {
    const results: ExtractedDateExpression[] = [];
    if (!text || typeof text !== "string") return results;

    const patterns = [
      // Day names with optional relative modifiers ("last monday", "this tuesday", bare "monday")
      /\b(?:(last|this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
      // Common relative offsets
      /\b(yesterday|today|tomorrow|this\s+morning|this\s+afternoon|tonight|last\s+week|two\s+days\s+ago|\d+\s+days?\s+ago|end\s+of\s+last\s+month|beginning\s+of\s+this\s+month)\b/gi,
      // "3 November", "3rd of November", "3 November 2026"
      /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*,?\s*\d{4})?)\b/gi,
      // "November 3", "Nov 3rd, 2026"
      /\b((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?)\b/gi,
      // ISO format YYYY-MM-DD
      /\b(\d{4}-\d{2}-\d{2})\b/g,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const expression = match[0].trim();
        const startIndex = match.index;
        const endIndex = startIndex + match[0].length;

        // Skip matches that overlap with an already captured span
        const overlaps = results.some(
          (r) =>
            (startIndex >= r.startIndex && startIndex < r.endIndex) ||
            (endIndex > r.startIndex && endIndex <= r.endIndex)
        );

        if (!overlaps) {
          results.push({ expression, startIndex, endIndex });
        }
      }
    }

    return results.sort((a, b) => a.startIndex - b.startIndex);
  }

  // Deterministically converts a relative string into an absolute Date object
  public resolve(expression: string): DateResolution | null {
    if (!expression || typeof expression !== "string") return null;
    const clean = expression.trim().toLowerCase();

    const ref = new Date(this.referenceDate);
    const refYear = ref.getUTCFullYear();
    const refMonth = ref.getUTCMonth();
    const refDate = ref.getUTCDate();
    const refDay = ref.getUTCDay();

    // Standard relative offsets
    if (clean === "yesterday") {
      const target = new Date(Date.UTC(refYear, refMonth, refDate - 1));
      return {
        resolvedDate: target,
        originalExpression: expression,
        confidence: "exact",
        formatted: this.formatForDisplay(target),
      };
    }

    if (
      clean === "today" ||
      clean === "this morning" ||
      clean === "this afternoon" ||
      clean === "tonight"
    ) {
      const target = new Date(Date.UTC(refYear, refMonth, refDate));
      return {
        resolvedDate: target,
        originalExpression: expression,
        confidence: "exact",
        formatted: this.formatForDisplay(target),
      };
    }

    if (clean === "tomorrow") {
      const target = new Date(Date.UTC(refYear, refMonth, refDate + 1));
      return {
        resolvedDate: target,
        originalExpression: expression,
        confidence: "exact",
        formatted: this.formatForDisplay(target),
      };
    }

    const daysAgoMatch = clean.match(/^(\d+|two|three|four|five|six|seven)\s+days?\s+ago$/);
    if (daysAgoMatch) {
      const wordMap: Record<string, number> = {
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
      };
      const count = wordMap[daysAgoMatch[1]] ?? parseInt(daysAgoMatch[1], 10);
      const target = new Date(Date.UTC(refYear, refMonth, refDate - count));
      return {
        resolvedDate: target,
        originalExpression: expression,
        confidence: "exact",
        formatted: this.formatForDisplay(target),
      };
    }

    if (clean === "last week") {
      const target = new Date(Date.UTC(refYear, refMonth, refDate - 7));
      return {
        resolvedDate: target,
        originalExpression: expression,
        confidence: "inferred",
        assumption: "Assumed 7 days prior to reference date",
        formatted: this.formatForDisplay(target),
      };
    }

    // Day 0 of refMonth points to the final day of the preceding month
    if (clean === "end of last month") {
      const target = new Date(Date.UTC(refYear, refMonth, 0));
      return {
        resolvedDate: target,
        originalExpression: expression,
        confidence: "exact",
        formatted: this.formatForDisplay(target),
      };
    }

    if (clean === "beginning of this month" || clean === "start of this month") {
      const target = new Date(Date.UTC(refYear, refMonth, 1));
      return {
        resolvedDate: target,
        originalExpression: expression,
        confidence: "exact",
        formatted: this.formatForDisplay(target),
      };
    }

    // Day-of-week parsing ("Monday" vs "last Monday")
    const dayMatch = clean.match(/^(?:(last|this|next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
    if (dayMatch) {
      const modifier = dayMatch[1] ?? "";
      const dayName = dayMatch[2];
      const targetDay = DAY_NAMES.indexOf(dayName as typeof DAY_NAMES[number]);

      if (targetDay !== -1) {
        if (modifier === "last") {
          // "last [day]" strictly means the occurrence in the previous calendar week
          const diffFromMostRecent = (refDay - targetDay + 7) % 7;
          const daysAgo = diffFromMostRecent === 0 ? 7 : diffFromMostRecent + 7;
          const target = new Date(Date.UTC(refYear, refMonth, refDate - daysAgo));
          return {
            resolvedDate: target,
            originalExpression: expression,
            confidence: "exact",
            assumption: `Resolved to previous week's ${dayName}`,
            formatted: this.formatForDisplay(target),
          };
        }

        if (modifier === "next") {
          const daysAhead = (targetDay - refDay + 7) % 7 || 7;
          const target = new Date(Date.UTC(refYear, refMonth, refDate + daysAhead));
          return {
            resolvedDate: target,
            originalExpression: expression,
            confidence: "exact",
            assumption: `Resolved to upcoming ${dayName}`,
            formatted: this.formatForDisplay(target),
          };
        }

        // Bare day name refers to the most recent past occurrence (or today if it's the same day)
        const diff = (refDay - targetDay + 7) % 7;
        const target = new Date(Date.UTC(refYear, refMonth, refDate - diff));
        return {
          resolvedDate: target,
          originalExpression: expression,
          confidence: "exact",
          assumption: diff === 0 ? `Today is ${dayName}` : `Resolved to most recent past ${dayName}`,
          formatted: this.formatForDisplay(target),
        };
      }
    }

    // Direct ISO timestamps (YYYY-MM-DD)
    const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      const target = new Date(Date.UTC(year, month, day));
      if (!isNaN(target.getTime())) {
        return {
          resolvedDate: target,
          originalExpression: expression,
          confidence: "exact",
          formatted: this.formatForDisplay(target),
        };
      }
    }

    // Natural date expressions ("3 November", "November 3", "3 Nov 2025")
    const dateMonthRegex = /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:\s*,?\s*(\d{4}))?$/;
    const monthDateRegex = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?$/;

    let dayStr: string | undefined;
    let monthStr: string | undefined;
    let explicitYearStr: string | undefined;

    const dmMatch = clean.match(dateMonthRegex);
    if (dmMatch) {
      dayStr = dmMatch[1];
      monthStr = dmMatch[2];
      explicitYearStr = dmMatch[3];
    } else {
      const mdMatch = clean.match(monthDateRegex);
      if (mdMatch) {
        monthStr = mdMatch[1];
        dayStr = mdMatch[2];
        explicitYearStr = mdMatch[3];
      }
    }

    if (dayStr && monthStr && MONTH_NAMES[monthStr] !== undefined) {
      const day = parseInt(dayStr, 10);
      const month = MONTH_NAMES[monthStr];

      if (explicitYearStr) {
        const year = parseInt(explicitYearStr, 10);
        const target = new Date(Date.UTC(year, month, day));
        return {
          resolvedDate: target,
          originalExpression: expression,
          confidence: "exact",
          formatted: this.formatForDisplay(target),
        };
      }

      // When the year is omitted, assume the most recent occurrence.
      // If the month/day is ahead of today in the current calendar year, it must refer to last year.
      const candidateThisYear = new Date(Date.UTC(refYear, month, day));
      if (candidateThisYear.getTime() <= ref.getTime()) {
        return {
          resolvedDate: candidateThisYear,
          originalExpression: expression,
          confidence: "inferred",
          assumption: `Assumed year ${refYear} for '${expression}'`,
          formatted: this.formatForDisplay(candidateThisYear),
        };
      } else {
        const candidateLastYear = new Date(Date.UTC(refYear - 1, month, day));
        return {
          resolvedDate: candidateLastYear,
          originalExpression: expression,
          confidence: "inferred",
          assumption: `Assumed year ${refYear - 1} for '${expression}' since it has not occurred yet this year`,
          formatted: this.formatForDisplay(candidateLastYear),
        };
      }
    }

    return null;
  }
}
