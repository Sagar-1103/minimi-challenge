import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { MessageWithToolCalls } from "../types/conversation.types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatTimestamp(date: Date | string): string {
  const d = new Date(date);
  const day = DAYS[d.getDay()];
  const dateStr = d.toISOString().split("T")[0];
  const time = d.toTimeString().slice(0, 5);
  return `[${dateStr} ${day} ${time}]`;
}

export function formatHistoryForLLM(
  messages: MessageWithToolCalls[]
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    const timestamp = formatTimestamp(msg.timestamp);

    switch (msg.role) {
      case "user": {
        result.push({
          role: "user",
          content: `${timestamp} ${msg.content ?? ""}`,
        });
        break;
      }

      case "assistant": {
        const toolCalls: ChatCompletionMessageToolCall[] = (
          msg.toolCalls || []
        ).map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.toolName,
            arguments: JSON.stringify({ query: tc.query }),
          },
        }));

        if (toolCalls.length > 0) {
          result.push({
            role: "assistant",
            content: null,
            tool_calls: toolCalls,
          });
          for (const tc of msg.toolCalls || []) {
            result.push({
              role: "tool",
              tool_call_id: tc.id,
              content: tc.result || "{}",
            });
          }
          if (msg.content) {
            result.push({
              role: "assistant",
              content: `${timestamp} ${msg.content}`,
            });
          }
        } else {
          result.push({
            role: "assistant",
            content: msg.content ? `${timestamp} ${msg.content}` : null,
          });
        }
        break;
      }

      case "tool": {
        result.push({
          role: "tool",
          tool_call_id: msg.toolCallId || msg.id,
          content: msg.content ?? "",
        });
        break;
      }

      case "system": {
        result.push({
          role: "system",
          content: msg.content ?? "",
        });
        break;
      }
    }
  }

  return result;
}
