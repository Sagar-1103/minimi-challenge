import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessage,
} from "openai/resources/chat/completions";
import { llm, getActiveModel } from "../lib/llm";
import { type TavilySearchResult } from "../lib/tavily";
import { buildSystemPrompt } from "../prompts/system";
import { webSearchArgsSchema } from "../schemas/search.schema";
import { LLMError, NotFoundError } from "../middlewares/errorHandler";
import { logger } from "../utils/logger";
import { conversationService } from "./conversation.service";
import { messageService } from "./message.service";
import { formatHistoryForLLM, formatTimestamp } from "./history.formatter";
import { DateResolver } from "./date-resolver";
import { determineAnchorDate } from "./anchor-date";
import { QueryBuilder } from "./query-builder";
import { SearchExecutor } from "./search/search-executor";
import type { ProcessedSearchResult } from "./search/result-processor";
import {
  historyRetriever,
  ambiguityHandler,
  reVerifier,
  historyManager,
  type HistoryMatch,
} from "./memory";
import {
  answerBuilder,
  type AnswerContext,
  type ProcessedAnswer,
  type ConfidenceLevel,
} from "./answer";
import {
  LoopBreaker,
  timeoutHandler,
  errorRecovery,
  contentFilter,
} from "./safety";
import type { AgentStep, ToolCall, ToolResult } from "../types/agent.types";
import type { SourceCitation } from "../types/chat.types";
import type { ToolCallRecordInput } from "../types/conversation.types";

const webSearchTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current, up-to-date, or time-sensitive information, recent events, or verifiable facts. Use specific, short queries (3-8 words). One entity or topic per query.",
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
  persist?: boolean;
}

export interface AgentRunResult {
  answer: string;
  conversationId?: string;
  messageId: string;
  sources: SourceCitation[];
  steps: AgentStep[];
  confidenceLevel?: ConfidenceLevel;
  entitiesCovered?: string[];
  entitiesMissed?: string[];
}

function extractDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return urlStr;
  }
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
  const shouldPersist = options.persist ?? true;

  let conversationId = options.conversationId;
  let currentUserMessageId: string | undefined;
  let priorHistory: ChatCompletionMessageParam[] = [];
  let rawHistory: Array<{ role: string; content: string | null; createdAt?: Date | string }> = [];

  // Load existing conversation or initialize a new one
  if (shouldPersist) {
    if (conversationId) {
      const existingConv = await conversationService.getById(conversationId);
      if (!existingConv) {
        throw new NotFoundError(`Conversation with ID "${conversationId}" not found`);
      }
      rawHistory = existingConv.messages;
      priorHistory = formatHistoryForLLM(existingConv.messages);
      const addedMsg = await messageService.addUserMessage(conversationId, userMessage);
      currentUserMessageId = addedMsg.id;
    } else {
      const newConv = await conversationService.create(userMessage);
      conversationId = newConv.id;
      const addedMsg = await messageService.addUserMessage(conversationId, userMessage);
      currentUserMessageId = addedMsg.id;
    }
  } else if (options.history) {
    priorHistory = options.history;
  }

  // Ground temporal context (resolve anchor dates and relative timeframes)
  const referenceDate = new Date();
  const dateResolver = new DateResolver(referenceDate);
  const anchorContext = determineAnchorDate(userMessage, rawHistory, dateResolver);
  const queryBuilder = new QueryBuilder(referenceDate, anchorContext?.anchorDate);
  const searchExecutor = new SearchExecutor({
    maxConcurrency: 5,
    timeoutMs: 12000,
    maxTotalSearches: 20,
  });

  const processedSearchResultsByEntity = new Map<string, ProcessedSearchResult[]>();

  if (anchorContext) {
    logger.info(
      `Temporal Anchor identified: ${dateResolver.formatForDisplay(anchorContext.anchorDate)} (${anchorContext.daysBetween}d ago via ${anchorContext.source})`
    );
  }

  const steps: AgentStep[] = [];
  const sourcesMap = new Map<string, SourceCitation>();
  const executedToolCalls: ToolCallRecordInput[] = [];

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

  // Check for past conversation recall or re-verification intent
  const reference = ambiguityHandler.detectReference(userMessage, dateResolver);
  let recalledHistoryPrompt = "";

  if (reference) {
    if (reference.type === "implicit_followup") {
      const lastAssistantTurn = rawHistory
        .slice()
        .reverse()
        .find((m) => m.role === "assistant" && m.content);

      if (lastAssistantTurn && lastAssistantTurn.content) {
        const report = await reVerifier.verify(
          conversationId || "",
          undefined,
          undefined,
          dateResolver,
          currentUserMessageId
        );
        if (report) {
          recalledHistoryPrompt = reVerifier.formatReportForLLM(report);
        }
      }
    } else {
      let matches: HistoryMatch[] = [];
      if (reference.type === "date_and_topic") {
        matches = await historyRetriever.findByDateAndTopic(
          conversationId || "",
          reference.dateExpression,
          reference.topic,
          dateResolver,
          currentUserMessageId
        );
      } else if (reference.type === "date_only") {
        matches = await historyRetriever.findByDate(
          conversationId || "",
          reference.dateExpression,
          dateResolver,
          currentUserMessageId
        );
      } else if (reference.type === "topic_only") {
        matches = await historyRetriever.findByTopic(
          conversationId || "",
          reference.topic,
          currentUserMessageId
        );
      }

      if (matches.length === 0) {
        matches = await historyRetriever.findAcrossConversations(
          reference.type !== "topic_only" ? reference.dateExpression : undefined,
          reference.type !== "date_only" ? reference.topic : undefined,
          dateResolver,
          currentUserMessageId
        );
      }

      // If no past turn was found, state it honestly without fabricating history
      if (matches.length === 0) {
        const targetDesc =
          reference.type === "date_only"
            ? reference.dateExpression
            : reference.type === "topic_only"
            ? reference.topic
            : `${reference.dateExpression} regarding ${reference.topic}`;

        const notFoundAnswer = `I checked our conversation history, but I couldn't find any recorded questions or discussions matching "${targetDesc}".`;

        steps.push({
          index: 1,
          type: "final_answer",
          output: notFoundAnswer,
          timestamp: new Date().toISOString(),
        });

        let savedMessageId = `msg_${Date.now()}`;
        if (shouldPersist && conversationId) {
          const savedMsg = await messageService.addAssistantMessage(
            conversationId,
            notFoundAnswer,
            [],
            activeModel
          );
          savedMessageId = savedMsg.id;
        }

        return {
          answer: notFoundAnswer,
          conversationId,
          messageId: savedMessageId,
          sources: [],
          steps,
        };
      }

      // If multiple turns match on a date reference, ask for user clarification
      if (matches.length > 1 && reference.type === "date_only") {
        const disambiguationAnswer = ambiguityHandler.formatDisambiguation(matches);

        steps.push({
          index: 1,
          type: "final_answer",
          output: disambiguationAnswer,
          timestamp: new Date().toISOString(),
        });

        let savedMessageId = `msg_${Date.now()}`;
        if (shouldPersist && conversationId) {
          const savedMsg = await messageService.addAssistantMessage(
            conversationId,
            disambiguationAnswer,
            [],
            activeModel
          );
          savedMessageId = savedMsg.id;
        }

        return {
          answer: disambiguationAnswer,
          conversationId,
          messageId: savedMessageId,
          sources: [],
          steps,
        };
      }

      // Single match: retrieve full exchange and optionally re-verify claims
      const matchedTurn = matches[0];
      const exchange = await historyRetriever.getFullExchange(matchedTurn.message.id);

      if (exchange) {
        const asksReverify = /\b(still\s+correct|accurate|changed|current|update|valid|prices?)\b/i.test(
          userMessage
        );

        let reverifyBlock = "";
        if (asksReverify) {
          const report = await reVerifier.verify(
            exchange.userMessage.conversationId,
            reference.type !== "topic_only" ? reference.dateExpression : undefined,
            reference.type !== "date_only" ? reference.topic : undefined,
            dateResolver,
            currentUserMessageId
          );
          if (report) {
            reverifyBlock = `\n\n${reVerifier.formatReportForLLM(report)}`;
          }
        }

        recalledHistoryPrompt = [
          "### Recalled Historical Conversation",
          `- **Date**: ${dateResolver.formatForDisplay(exchange.timestamp)}`,
          `- **User Question**: "${exchange.userMessage.content}"`,
          `- **Assistant Answer**: "${exchange.assistantResponse.content}"`,
          reverifyBlock,
          "",
          "Ground your answer strictly in this recalled exchange. Restate the question and answer clearly. If re-verification details are provided, indicate whether the old facts remain accurate or have changed.",
        ].join("\n");
      }
    }
  }

  const isReverify =
    !!reference &&
    (reference.type === "implicit_followup" ||
      /\b(still\s+correct|accurate|changed|current|update|valid)\b/i.test(userMessage));
  const questionType = answerBuilder.detectQuestionType(
    userMessage,
    !!anchorContext,
    isReverify
  );
  const entities = answerBuilder.extractEntities(userMessage);

  const answerContext: AnswerContext = {
    userQuestion: userMessage,
    questionType,
    searchResults: processedSearchResultsByEntity,
    entities,
    anchorDate: anchorContext?.anchorDate,
    todayDate: referenceDate,
  };

  const answerDirective = answerBuilder.buildAnswerPrompt(answerContext);

  const currentFormattedUserMessage = `${formatTimestamp(referenceDate)} ${userMessage}`;

  let messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        referenceDate,
        timezone: "UTC",
        anchorDate: anchorContext,
        answerDirective,
      }),
    },
    ...priorHistory,
    ...(recalledHistoryPrompt
      ? [
          {
            role: "system" as const,
            content: recalledHistoryPrompt,
          },
        ]
      : []),
    { role: "user", content: currentFormattedUserMessage },
  ];

  // Trim messages if needed to fit within context window limits
  messages = historyManager.trimHistory(messages, 4000);

  const agentStartTime = Date.now();
  const loopBreaker = new LoopBreaker({
    maxIterations,
    maxToolCalls: 20,
    maxDuplicateQueries: 2,
  });

  let iteration = 0;

  while (loopBreaker.shouldContinue().continue && !timeoutHandler.isExpired(agentStartTime)) {
    loopBreaker.recordIteration();
    iteration = loopBreaker.getIterationCount();

    logger.agent(iteration, "Sending request to LLM", {
      model: activeModel,
      messageCount: messages.length,
      conversationId,
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

      messages.push(message);

      logger.agent(
        iteration,
        `Executing ${toolCallsList.length} tool call(s) in parallel`,
        toolCallsList.map((tc) => queryBuilder.enrichQuery(tc.arguments.query || ""))
      );

      // Separate valid tool calls from invalid ones
      const validSearchQueries: Array<{ id: string; query: string }> = [];
      const toolResults: ToolResult[] = [];

      for (const tc of toolCallsList) {
        const startTime = Date.now();
        const parseResult = webSearchArgsSchema.safeParse(tc.arguments);

        if (!parseResult.success) {
          const errorMsg = `Invalid search arguments: ${parseResult.error.issues.map((i) => i.message).join(", ")}`;
          logger.warn(`Tool call ${tc.id} failed validation: ${errorMsg}`);
          const duration = Date.now() - startTime;
          executedToolCalls.push({
            toolName: tc.name,
            query: typeof tc.arguments?.query === "string" ? tc.arguments.query : "",
            result: JSON.stringify({ error: errorMsg }),
            status: "FAILED",
            duration,
          });

          toolResults.push({
            toolCallId: tc.id,
            name: tc.name,
            result: JSON.stringify({ error: errorMsg, results: [] }),
          });
        } else {
          const rawQuery = parseResult.data.query;

          if (loopBreaker.isDuplicateQuery(rawQuery)) {
            const skipMsg = `Search skipped: duplicate query "${rawQuery}" was already executed. Please synthesize your answer using already collected findings.`;
            logger.warn(`Tool call ${tc.id} duplicate query skipped: ${rawQuery}`);
            executedToolCalls.push({
              toolName: tc.name,
              query: rawQuery,
              result: skipMsg,
              status: "SUCCESS",
              duration: 0,
            });
            toolResults.push({
              toolCallId: tc.id,
              name: tc.name,
              result: skipMsg,
            });
            continue;
          }

          const query = queryBuilder.enrichQuery(rawQuery);
          validSearchQueries.push({ id: tc.id, query });
        }
      }

      loopBreaker.recordToolCalls(toolCallsList);

      // Execute valid searches through SearchExecutor (parallel, deduplicated, cached, and ranked)
      if (validSearchQueries.length > 0) {
        const batchResults = await searchExecutor.executeParallel(
          validSearchQueries,
          anchorContext?.anchorDate
        );

        for (const vq of validSearchQueries) {
          const execRes = batchResults.get(vq.id);
          if (execRes) {
            for (const item of execRes.rawResults) {
              addSource(item);
            }

            if (execRes.results && execRes.results.length > 0) {
              processedSearchResultsByEntity.set(vq.query, execRes.results);
            }

            executedToolCalls.push({
              toolName: "web_search",
              query: vq.query,
              result: execRes.formatted.slice(0, 1500),
              status: "SUCCESS",
              duration: execRes.duration,
            });

            toolResults.push({
              toolCallId: vq.id,
              name: "web_search",
              result: execRes.formatted,
            });
          }
        }
      }

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

      // Check if we hit the limit after executing tools or time budget expired
      if (!loopBreaker.shouldContinue().continue || timeoutHandler.isExpired(agentStartTime)) {
        logger.warn("Agent reached step limit or timeout. Forcing final answer.");
        messages.push({
          role: "system",
          content: loopBreaker.getForceAnswerMessage(),
        });

        const forcedResponse = await callLLMWithRetry({
          model: activeModel,
          messages,
          temperature,
        });

        const rawContent =
          forcedResponse.choices[0]?.message?.content ||
          "I have gathered the available information, but reached the limit before completing further searches.";

        const processed = answerBuilder.postProcess(rawContent, answerContext);
        for (const c of processed.citations) {
          if (!sourcesMap.has(c.url)) {
            sourcesMap.set(c.url, {
              title: c.title,
              url: c.url,
              domain: c.domain,
              date: c.publishedDate,
            });
          }
        }

        steps.push({
          index: iteration + 1,
          type: "final_answer",
          output: processed.content,
          timestamp: new Date().toISOString(),
        });

        let savedMessageId = `msg_${Date.now()}`;
        if (shouldPersist && conversationId) {
          const savedMsg = await messageService.addAssistantMessage(
            conversationId,
            processed.content,
            executedToolCalls,
            activeModel
          );
          savedMessageId = savedMsg.id;
        }

        return {
          answer: processed.content,
          conversationId,
          messageId: savedMessageId,
          sources: Array.from(sourcesMap.values()),
          steps,
          confidenceLevel: processed.confidenceLevel,
          entitiesCovered: processed.entitiesCovered,
          entitiesMissed: processed.entitiesMissed,
        };
      }

      // Continue loop with new tool results in context
      continue;
    }

    // No tool calls - the model generated a final answer
    const rawAnswer = message.content || "";
    logger.agent(iteration, "Final answer generated");

    const processed = answerBuilder.postProcess(rawAnswer, answerContext);
    for (const c of processed.citations) {
      if (!sourcesMap.has(c.url)) {
        sourcesMap.set(c.url, {
          title: c.title,
          url: c.url,
          domain: c.domain,
          date: c.publishedDate,
        });
      }
    }

    steps.push({
      index: iteration,
      type: "final_answer",
      output: processed.content,
      timestamp: new Date().toISOString(),
    });

    let savedMessageId = `msg_${Date.now()}`;
    if (shouldPersist && conversationId) {
      const savedMsg = await messageService.addAssistantMessage(
        conversationId,
        processed.content,
        executedToolCalls,
        activeModel
      );
      savedMessageId = savedMsg.id;
    }

    return {
      answer: processed.content,
      conversationId,
      messageId: savedMessageId,
      sources: Array.from(sourcesMap.values()),
      steps,
      confidenceLevel: processed.confidenceLevel,
      entitiesCovered: processed.entitiesCovered,
      entitiesMissed: processed.entitiesMissed,
    };
  }

  // Fallback if loop exits without returning
  const fallbackAnswer = "I could not complete the request within the allowed steps.";
  let savedMessageId = `msg_${Date.now()}`;
  if (shouldPersist && conversationId) {
    const savedMsg = await messageService.addAssistantMessage(
      conversationId,
      fallbackAnswer,
      executedToolCalls,
      activeModel
    );
    savedMessageId = savedMsg.id;
  }

  return {
    answer: fallbackAnswer,
    conversationId,
    messageId: savedMessageId,
    sources: Array.from(sourcesMap.values()),
    steps,
    confidenceLevel: "unverifiable",
    entitiesCovered: [],
    entitiesMissed: answerContext.entities,
  };
}
