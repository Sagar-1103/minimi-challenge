import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessage,
} from "openai/resources/chat/completions";
import { llm, getActiveModel } from "../lib/llm";
import { searchWeb, type TavilySearchResponse, type TavilySearchResult } from "../lib/tavily";
import { buildSystemPrompt } from "../prompts/system";
import { webSearchArgsSchema } from "../schemas/search.schema";
import { LLMError } from "../middlewares/errorHandler";
import { logger } from "../utils/logger";
import type { AgentStep, ToolCall, ToolResult } from "../types/agent.types";
import type { SourceCitation } from "../types/chat.types";

const webSearchTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current, up-to-date, or time-sensitive information such as pricing, recent releases, news, and changes. Use specific, short queries (3-8 words). One entity per query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Specific search query (3-8 words), including product/topic name and current year if relevant.",
        },
      },
      required: ["query"],
    },
  },
};

export interface RunAgentOptions {
  conversationId?: string;
  history?: ChatCompletionMessageParam[];
  maxIterations?: number;
  temperature?: number;
}

export interface AgentRunResult {
  answer: string;
  conversationId?: string;
  messageId: string;
  sources: SourceCitation[];
  steps: AgentStep[];
}

function extractDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
}

function formatSearchResultForLLM(res: TavilySearchResponse): string {
  if (!res.results || res.results.length === 0) {
    return JSON.stringify({
      query: res.query,
      answer: res.answer ?? null,
      message: "No results found for this query.",
      results: [],
    });
  }

  return JSON.stringify({
    query: res.query,
    answer: res.answer ?? null,
    results: res.results.slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content ? r.content.slice(0, 600) : "",
      publishedDate: r.publishedDate,
    })),
  });
}

async function callLLMWithRetry(
  params: Parameters<typeof llm.chat.completions.create>[0],
  maxRetries = 3
): Promise<any> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await llm.chat.completions.create(params, {
        signal: AbortSignal.timeout(35000),
      });
    } catch (err: any) {
      attempt++;
      logger.warn(
        `LLM call failed (attempt ${attempt}/${maxRetries}): ${err.message}`
      );
      if (attempt >= maxRetries) {
        throw new LLMError(
          `LLM call failed after ${maxRetries} attempts: ${err.message}`,
          err
        );
      }
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 8000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function runAgent(
  userMessage: string,
  options: RunAgentOptions = {}
): Promise<AgentRunResult> {
  const maxIterations = options.maxIterations ?? 12;
  const temperature = options.temperature ?? 0.1;
  const activeModel = getActiveModel();
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const steps: AgentStep[] = [];
  const sourcesMap = new Map<string, SourceCitation>();

  const addSource = (r: TavilySearchResult) => {
    if (r.url && !sourcesMap.has(r.url)) {
      sourcesMap.set(r.url, {
        title: r.title || r.url,
        url: r.url,
        domain: extractDomain(r.url),
        date: r.publishedDate,
      });
    }
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...(options.history || []),
    { role: "user", content: userMessage },
  ];

  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    logger.agent(iteration, "Sending request to LLM", {
      model: activeModel,
      messageCount: messages.length,
    });

    const llmResponse = await callLLMWithRetry({
      model: activeModel,
      messages,
      tools: [webSearchTool],
      tool_choice: "auto",
      temperature,
    });

    const choice = llmResponse.choices[0];
    const message = choice.message as ChatCompletionMessage;

    // Check if the model called any tools
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCallsList: ToolCall[] = message.tool_calls.map((tc: any) => {
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = { query: tc.function.arguments };
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        };
      });

      steps.push({
        index: iteration,
        type: "llm_call",
        output: {
          role: "assistant",
          content: message.content,
          toolCalls: toolCallsList,
        },
        timestamp: new Date().toISOString(),
      });

      // Append assistant message with tool calls to context
      messages.push(message);

      logger.agent(
        iteration,
        `Executing ${toolCallsList.length} tool call(s) in parallel`,
        toolCallsList.map((tc) => tc.arguments.query)
      );

      // Execute all tool calls in parallel using Promise.allSettled
      const executionPromises = toolCallsList.map(async (tc) => {
        const parseResult = webSearchArgsSchema.safeParse(tc.arguments);
        if (!parseResult.success) {
          const errorMsg = `Invalid search arguments: ${parseResult.error.issues.map((i) => i.message).join(", ")}`;
          logger.warn(`Tool call ${tc.id} failed validation: ${errorMsg}`);
          return {
            toolCallId: tc.id,
            name: tc.name,
            result: JSON.stringify({
              error: errorMsg,
              results: [],
            }),
          };
        }

        const query = parseResult.data.query;
        try {
          const searchRes = await searchWeb({ query });
          for (const item of searchRes.results) {
            addSource(item);
          }
          return {
            toolCallId: tc.id,
            name: tc.name,
            result: formatSearchResultForLLM(searchRes),
          };
        } catch (err: any) {
          logger.error(`Search failed for query "${query}": ${err.message}`);
          return {
            toolCallId: tc.id,
            name: tc.name,
            result: JSON.stringify({
              query,
              error: err.message,
              results: [],
            }),
          };
        }
      });

      const settledResults = await Promise.allSettled(executionPromises);
      const toolResults: ToolResult[] = settledResults.map((sr, idx) => {
        if (sr.status === "fulfilled") {
          return sr.value;
        }
        return {
          toolCallId: toolCallsList[idx].id,
          name: toolCallsList[idx].name,
          result: JSON.stringify({
            query: toolCallsList[idx].arguments.query,
            error: sr.reason?.message ?? "Execution failed",
            results: [],
          }),
        };
      });

      // Append tool responses to messages
      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: tr.toolCallId,
          content: tr.result,
        });
      }

      steps.push({
        index: iteration,
        type: "tool_execution",
        toolCalls: toolCallsList,
        toolResults,
        timestamp: new Date().toISOString(),
      });

      // Check if we hit the limit after executing tools
      if (iteration >= maxIterations) {
        logger.warn(
          `Agent reached max iterations (${maxIterations}). Forcing final answer.`
        );
        messages.push({
          role: "system",
          content:
            "You have reached the maximum search iterations. Synthesize and provide your final answer now with whatever information you have gathered. State clearly if any part could not be verified. Do not make further tool calls.",
        });

        const forcedResponse = await callLLMWithRetry({
          model: activeModel,
          messages,
          temperature,
        });

        const finalContent =
          forcedResponse.choices[0]?.message?.content ||
          "I have gathered the available information, but reached the limit before completing further searches.";

        steps.push({
          index: iteration + 1,
          type: "final_answer",
          output: finalContent,
          timestamp: new Date().toISOString(),
        });

        return {
          answer: finalContent,
          conversationId: options.conversationId,
          messageId,
          sources: Array.from(sourcesMap.values()),
          steps,
        };
      }

      // Continue loop with new tool results in context
      continue;
    }

    // No tool calls - the model generated a final answer
    const finalAnswer = message.content || "";
    logger.agent(iteration, "Final answer generated");

    steps.push({
      index: iteration,
      type: "final_answer",
      output: finalAnswer,
      timestamp: new Date().toISOString(),
    });

    return {
      answer: finalAnswer,
      conversationId: options.conversationId,
      messageId,
      sources: Array.from(sourcesMap.values()),
      steps,
    };
  }

  // Fallback if loop exits without returning
  return {
    answer: "I could not complete the request within the allowed steps.",
    conversationId: options.conversationId,
    messageId,
    sources: Array.from(sourcesMap.values()),
    steps,
  };
}
