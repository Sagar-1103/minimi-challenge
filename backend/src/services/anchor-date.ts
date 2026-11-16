import { DateResolver, type DateResolution } from "./date-resolver";

export interface AnchorDateContext {
  anchorDate: Date;
  todayDate: Date;
  daysBetween: number;
  searchWindowDescription: string;
  resolvedExpression?: string;
  source: "explicit_mention" | "history_match" | "previous_turn";
  assumption?: string;
}

export interface HistoryItem {
  role: string;
  content: string | null;
  createdAt?: Date | string;
}

/**
 * Resolves the baseline "anchor" date when the user asks "what changed since X?".
 * First checks for explicit dates in the prompt ("since Monday", "on Nov 3"),
 * then falls back to the last user turn if they're following up ("since then", "still").
 */
export function determineAnchorDate(
  userMessage: string,
  conversationHistory: HistoryItem[] = [],
  dateResolver: DateResolver
): AnchorDateContext | null {
  const today = dateResolver.getReferenceDate();

  // Try extracting explicit dates from the message first
  const expressions = dateResolver.extractDateExpressions(userMessage);
  for (const expr of expressions) {
    const resolution: DateResolution | null = dateResolver.resolve(expr.expression);
    if (resolution && resolution.resolvedDate.getTime() <= today.getTime()) {
      const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      const resMidnight = Date.UTC(
        resolution.resolvedDate.getUTCFullYear(),
        resolution.resolvedDate.getUTCMonth(),
        resolution.resolvedDate.getUTCDate()
      );
      const daysBetween = Math.max(
        0,
        Math.floor((todayMidnight - resMidnight) / (1000 * 60 * 60 * 24))
      );

      return {
        anchorDate: resolution.resolvedDate,
        todayDate: today,
        daysBetween,
        searchWindowDescription: `between ${resolution.formatted} and today (${dateResolver.formatForDisplay(today)})`,
        resolvedExpression: resolution.originalExpression,
        source: "explicit_mention",
        assumption: resolution.assumption,
      };
    }
  }

  // If the user refers to prior context ("since then", "still true?"), anchor to the last user turn
  const hasRelativeTemporalReference = /\b(then|earlier|before|previously|prior|still|since)\b/i.test(userMessage);

  if (hasRelativeTemporalReference && conversationHistory.length > 0) {
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const msg = conversationHistory[i];
      if (msg.role === "user" && msg.createdAt) {
        const msgDate = new Date(msg.createdAt);
        if (!isNaN(msgDate.getTime()) && msgDate.getTime() <= today.getTime()) {
          const daysBetween = Math.max(
            0,
            Math.round((today.getTime() - msgDate.getTime()) / (1000 * 60 * 60 * 24))
          );

          const formattedAnchor = dateResolver.formatForDisplay(msgDate);
          return {
            anchorDate: msgDate,
            todayDate: today,
            daysBetween,
            searchWindowDescription: `between ${formattedAnchor} and today (${dateResolver.formatForDisplay(today)})`,
            source: "previous_turn",
            assumption: `Anchored to previous conversation turn on ${formattedAnchor}`,
          };
        }
      }
    }
  }

  return null;
}
