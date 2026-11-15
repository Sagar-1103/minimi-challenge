import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { MessageWithToolCalls } from "../../types/conversation.types";
import { llm, getActiveModel } from "../../lib/llm";
import { logger } from "../../utils/logger";

export interface TopicIndexEntry {
  messageId: string;
  date: string;
  time: string;
  topic: string;
  brief: string;
}

export class HistoryManager {
  // Approximate tokens from text characters (roughly 4 characters per token)
  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  // Estimate total tokens for a message object
  private getMessageTokens(msg: ChatCompletionMessageParam): number {
    let contentStr = "";
    if (typeof msg.content === "string") {
      contentStr = msg.content;
    } else if (Array.isArray(msg.content)) {
      contentStr = JSON.stringify(msg.content);
    }
    return this.estimateTokens(contentStr) + 4; // overhead per turn
  }

  // Trim conversation history while preserving system prompt, referenced turns, and the most recent messages
  trimHistory(
    messages: ChatCompletionMessageParam[],
    maxTokens = 4000,
    referencedTurns: string[] = []
  ): ChatCompletionMessageParam[] {
    if (messages.length <= 2) return messages;

    let systemMessage: ChatCompletionMessageParam | null = null;
    const turnsToKeep: ChatCompletionMessageParam[] = [];
    const referencedSet = new Set(referencedTurns);

    let tokenCount = 0;

    // Retain the system message
    if (messages[0]?.role === "system") {
      systemMessage = messages[0];
      tokenCount += this.getMessageTokens(systemMessage);
    }

    const conversationTurns = systemMessage ? messages.slice(1) : messages;

    // Scan backwards from most recent turn to older turns
    const selectedIndices = new Set<number>();

    for (let i = conversationTurns.length - 1; i >= 0; i--) {
      const msg = conversationTurns[i];
      const content = typeof msg.content === "string" ? msg.content : "";
      const isReferenced = referencedTurns.some((ref) => ref && content.includes(ref));
      const tokens = this.getMessageTokens(msg);

      if (isReferenced || tokenCount + tokens <= maxTokens) {
        selectedIndices.add(i);
        tokenCount += tokens;
      } else if (!isReferenced && tokenCount + tokens > maxTokens) {
        // Exceeded budget; continue checking in case an older turn was explicitly referenced
        continue;
      }
    }

    for (let i = 0; i < conversationTurns.length; i++) {
      if (selectedIndices.has(i)) {
        turnsToKeep.push(conversationTurns[i]);
      }
    }

    return systemMessage ? [systemMessage, ...turnsToKeep] : turnsToKeep;
  }

  // Summarize older turns before cutoffIndex to condense context window
  async summarizeHistory(
    messages: ChatCompletionMessageParam[],
    cutoffIndex: number
  ): Promise<string> {
    const toSummarize = messages.slice(0, cutoffIndex);
    if (toSummarize.length === 0) return "";

    const transcript = toSummarize
      .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : ""}`)
      .join("\n");

    try {
      const activeModel = getActiveModel();
      const response = await llm.chat.completions.create(
        {
          model: activeModel,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "Condense this earlier conversation history into a concise 2-3 sentence factual summary. Highlight topics discussed and key conclusions reached.",
            },
            {
              role: "user",
              content: transcript,
            },
          ],
        },
        { signal: AbortSignal.timeout(10000) }
      );

      return response.choices[0]?.message?.content?.trim() || "";
    } catch (err: any) {
      logger.warn(`LLM history summarization failed: ${err.message}`);
      return `Prior discussion covered ${toSummarize.length} messages on earlier topics.`;
    }
  }

  // Build a lightweight index of user messages and topics for quick retrieval
  buildTopicIndex(messages: MessageWithToolCalls[]): TopicIndexEntry[] {
    const index: TopicIndexEntry[] = [];

    for (const msg of messages) {
      if (msg.role !== "user" || !msg.content) continue;

      const dateObj = new Date(msg.timestamp);
      const date = dateObj.toISOString().split("T")[0];
      const time = dateObj.toTimeString().slice(0, 5);

      const cleanContent = msg.content.trim().replace(/\s+/g, " ");
      const brief =
        cleanContent.length > 100
          ? `${cleanContent.slice(0, 97)}...`
          : cleanContent;

      // Extract a representative topic from the first sentence or clause
      const firstSentence = cleanContent.split(/[.?!]/)[0];
      const topic =
        firstSentence.length > 50
          ? `${firstSentence.slice(0, 47)}...`
          : firstSentence;

      index.push({
        messageId: msg.id,
        date,
        time,
        topic,
        brief,
      });
    }

    return index;
  }
}

export const historyManager = new HistoryManager();
