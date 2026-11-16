import type { HistoryMatch } from "./history-retriever";
import { DateResolver } from "../date-resolver";

export type ReferenceType =
  | { type: "date_only"; dateExpression: string }
  | { type: "topic_only"; topic: string }
  | { type: "date_and_topic"; dateExpression: string; topic: string }
  | { type: "implicit_followup" }
  | null;

export class AmbiguityHandler {
  // Check if a message explicitly asks about or references past memory/conversations
  isExplicitRecallQuery(message: string): boolean {
    if (!message || typeof message !== "string") return false;
    const text = message.trim();
    return /\b(did I (?:mention|say|tell you|ask)|what did I (?:mention|say|tell you|ask)|where (?:did I say|was I planning)|what was I planning|what (?:were|are) my (?:preferences?|plans?)|where did I want to|remind me (?:what|about|of|where)|do you remember (?:what|where|who|when|if|that|my|our)|what cold weather|what destinations|what places did I|in (?:our|a|my) (?:previous|last|past) (?:chat|conversation|message))\b/i.test(
      text
    );
  }

  // Identify if the user's message is a memory recall or re-verification query
  detectReference(message: string, dateResolver?: DateResolver): ReferenceType {
    if (!message || typeof message !== "string") return null;
    const text = message.trim();

    const resolver = dateResolver || new DateResolver();
    const dateExprs = resolver.extractDateExpressions(text);
    const dateExpression = dateExprs.length > 0 ? dateExprs[0].expression : null;

    // Detect explicit topic clauses like "about X", "regarding X", "for X"
    let extractedTopic: string | null = null;
    const topicMatch = text.match(
      /\b(?:about|regarding|discussing|on the topic of|re)\s+([^.?!,]+)/i
    );

    if (topicMatch) {
      let candidate = topicMatch[1].trim();
      // Remove trailing phrases such as "is that still true" or "and if"
      candidate = candidate.replace(
        /\s+(?:is\s+(?:your\s+answer|that|it|everything)\s+still.*|and\s+if.*|has\s+anything\s+changed.*)$/i,
        ""
      );
      // Remove date expression if accidentally captured as part of topic
      if (dateExpression) {
        candidate = candidate.replace(new RegExp(`\\b${dateExpression}\\b`, "i"), "").trim();
      }
      candidate = candidate.replace(/[?!.]+$/, "").trim();

      if (candidate.length > 1 && !/^(it|that|this|things|them|anything|nothing)$/i.test(candidate)) {
        extractedTopic = candidate;
      }
    }

    // Check if the query is asking about previous conversations or re-verifying
    const hasRecallTrigger =
      /\b(what did I (?:ask|say|mention|tell you)|what was my (?:question|plan|preference|vacation|trip)|what did we discuss|what did I say|remind me (?:what|about|of|where)|do you remember (?:what|about|where|when|that)|did I (?:ask|mention|say|tell you)|what (?:destinations|places|topics) did I|last\s+[a-z]+\s+I\s+(?:asked|said|mentioned)|on\s+.*\s+I\s+(?:asked|said|mentioned))\b/i.test(
        text
      );

    const hasReverifyTrigger =
      /\b(is (?:your|that|the|my past|the previous) (?:answer|response|recommendation|pricing|info|information) still (?:correct|accurate|valid|true|up to date|current)|has anything changed|have things changed|did anything change|are those prices still|is that still the case|can you re-?verify)\b/i.test(
        text
      );

    // 1. Date and topic combined (requires an explicit topic or topic clause)
    if (dateExpression && extractedTopic && (hasRecallTrigger || hasReverifyTrigger || /\basked\b/i.test(text))) {
      return {
        type: "date_and_topic",
        dateExpression,
        topic: extractedTopic,
      };
    }

    // 2. Date only (date expression with recall intent, but no explicit topic)
    if (dateExpression && (hasRecallTrigger || hasReverifyTrigger || /^(?:what did I ask|what was asked)/i.test(text))) {
      return {
        type: "date_only",
        dateExpression,
      };
    }

    // 3. Topic only
    if (!dateExpression && (extractedTopic || hasRecallTrigger)) {
      return {
        type: "topic_only",
        topic: extractedTopic || text,
      };
    }

    // 4. Implicit follow-up (asking whether previous answer is still valid without restating date/topic)
    if (!dateExpression && !extractedTopic && hasReverifyTrigger) {
      return {
        type: "implicit_followup",
      };
    }

    // If a date expression is explicitly paired with asking about past turns
    if (dateExpression && /\b(I asked|we asked|my question|our discussion)\b/i.test(text)) {
      if (extractedTopic) {
        return { type: "date_and_topic", dateExpression, topic: extractedTopic };
      }
      return { type: "date_only", dateExpression };
    }

    return null;
  }

  // Format multiple potential history matches into a disambiguation prompt
  formatDisambiguation(matches: HistoryMatch[]): string {
    if (matches.length === 0) {
      return "I could not find any previous messages matching that timeframe.";
    }

    const items = matches.map((m, idx) => {
      const d = new Date(m.message.timestamp);
      const timeStr = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "UTC",
      });

      const content = m.message.content || "";
      const preview =
        content.length > 80 ? `${content.slice(0, 77)}...` : content;

      return `${idx + 1}. [${timeStr} UTC] "${preview}"`;
    });

    return [
      `I found ${matches.length} conversations around that time:`,
      ...items,
      "",
      "Which specific topic or question would you like me to re-verify?",
    ].join("\n");
  }
}

export const ambiguityHandler = new AmbiguityHandler();
