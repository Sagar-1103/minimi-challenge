"use client";

import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "lucide-react";
import type { ChatMessage, Citation } from "../lib/types";
import { ThinkingIndicator } from "./thinking-indicator";
import { CitationDrawer } from "./citation-drawer";
import { MarkdownTable } from "./markdown-table";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Extract citations and clean content for loaded messages if citations array wasn't provided
  const { displayContent, displayCitations } = useMemo(() => {
    let citations = message.citations || [];
    let content = message.content || "";

    if (citations.length === 0 && content) {
      const sourcesIndex = content.search(/\n*###?\s*(?:Sources|References)/i);
      if (sourcesIndex !== -1) {
        const sourcesSection = content.slice(sourcesIndex);
        const reg =
          /(?:(\d+)\.\s*)?\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)(?:\s*-\s*([^\(\[\n]+))?/g;
        const parsed: Citation[] = [];
        let m: RegExpExecArray | null;

        while ((m = reg.exec(sourcesSection)) !== null) {
          let domain = m[4] ? m[4].trim() : "";
          if (!domain) {
            try {
              domain = new URL(m[3]).hostname.replace(/^www\./, "");
            } catch {
              domain = "source";
            }
          }
          parsed.push({
            index: m[1] ? parseInt(m[1], 10) : parsed.length + 1,
            title: m[2].trim(),
            url: m[3].trim(),
            domain,
          });
        }

        if (parsed.length > 0) {
          citations = parsed;
          content = content.slice(0, sourcesIndex).trim();
        }
      }
    }

    return { displayContent: content, displayCitations: citations };
  }, [message.content, message.citations]);

  if (isUser) {
    // User question: clean, modern Perplexity-style card with hover action
    return (
      <div className="flex flex-col items-end my-6 group">
        <div className="rounded-2xl px-5 py-3 bg-white/[0.06] hover:bg-white/[0.08] border border-white/[0.1] text-white text-[14.5px] font-normal leading-relaxed max-w-[85%] shadow-sm backdrop-blur-md transition-colors">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 px-2 text-white/30 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 hover:text-white rounded hover:bg-white/[0.06] text-[11px] transition-colors cursor-pointer"
            title="Copy question"
          >
            {copied ? (
              <Check className="size-3 text-green-400" />
            ) : (
              <Copy className="size-3" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
    );
  }

  // Assistant Turn (Perplexity-inspired: clean layout, NO monogram badge)
  const hasThinking =
    (message.isStreaming && Boolean(message.statusText)) ||
    (message.toolCalls && message.toolCalls.length > 0) ||
    Boolean(message.isStreaming);

  const hasCitations = displayCitations.length > 0;

  return (
    <div className="my-6 w-full animate-in fade-in duration-200">
      {/* 1. Real-time Thinking & Search Status */}
      {hasThinking && (
        <ThinkingIndicator
          statusText={message.statusText}
          toolCalls={message.toolCalls}
          isStreaming={message.isStreaming}
        />
      )}

      {/* 2. Main Answer Body */}
      {displayContent && (
        <div className="mt-3 prose prose-invert max-w-none text-[14.5px] leading-relaxed text-white/90 break-words">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-lg font-semibold text-white mt-6 mb-3 tracking-tight">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-[16px] font-semibold text-white mt-5 mb-2.5 tracking-tight">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-[14.5px] font-medium text-white/95 mt-4 mb-2">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="mb-3.5 text-white/85 leading-[1.68]">
                  {children}
                </p>
              ),
              ul: ({ children }) => (
                <ul className="my-3 space-y-1.5 list-disc list-outside ml-4 text-white/85">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="my-3 space-y-1.5 list-decimal list-outside ml-4 text-white/85">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="leading-relaxed pl-1">
                  {children}
                </li>
              ),
              a: ({ href, children }) => {
                const text = String(children);
                // Check if link is a citation badge like [1] or 1
                const isNumericCitation = /^\[?\d+\]?$/.test(text.trim());
                if (isNumericCitation) {
                  const num = text.replace(/[\[\]]/g, "");
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center min-w-[15px] h-3.5 px-1 rounded-full bg-white/10 hover:bg-blue-500/25 text-blue-300 hover:text-blue-200 text-[10px] font-mono font-medium mx-0.5 align-super cursor-pointer border border-white/15 transition-all"
                      title={href}
                    >
                      {num}
                    </a>
                  );
                }
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 font-medium underline underline-offset-2 decoration-blue-400/40 hover:decoration-blue-300 transition-colors cursor-pointer"
                  >
                    {children}
                  </a>
                );
              },
              table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
              thead: ({ children }) => (
                <thead className="sticky top-0 bg-[#0E121A] border-b border-white/[0.08] text-[11px] font-semibold text-white/60 uppercase tracking-wider z-10 backdrop-blur-md">
                  {children}
                </thead>
              ),
              tr: ({ children }) => (
                <tr className="hover:bg-white/[0.025] transition-colors">
                  {children}
                </tr>
              ),
              th: ({ children }) => (
                <th className="py-3 px-4 font-semibold text-white/90 whitespace-nowrap">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="py-3 px-4 border-b border-white/[0.05] text-white/80 leading-normal align-top">
                  {children}
                </td>
              ),
              code: ({ className, children }) => {
                const isInline = !className;
                if (isInline) {
                  return (
                    <code className="px-1.5 py-0.5 rounded text-[12px] font-mono bg-white/[0.08] text-blue-300 border border-white/10">
                      {children}
                    </code>
                  );
                }
                return (
                  <code className="block p-4 rounded-xl text-xs font-mono bg-[#0A0D14] text-neutral-200 overflow-x-auto my-3 border border-white/10 shadow-xs">
                    {children}
                  </code>
                );
              },
              hr: () => (
                <div className="my-6 h-px w-full bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
              ),
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>
      )}

      {/* 3. Sources Section with a gentle ethereal gradient fade line */}
      {hasCitations && (
        <div className="mt-6 pt-1">
          <div className="h-px w-full bg-gradient-to-r from-white/[0.08] via-white/[0.03] to-transparent mb-3.5" />
          <CitationDrawer citations={displayCitations} />
        </div>
      )}

      {/* 4. Action Toolbar at bottom (clean, unboxed) */}
      {displayContent && !message.isStreaming && (
        <div className="flex items-center gap-3 mt-3 text-white/40">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs hover:text-white/80 hover:bg-white/[0.05] transition-all duration-150 active:scale-95 cursor-pointer"
            title="Copy response"
          >
            {copied ? (
              <>
                <Check className="size-3 text-green-400" />
                <span className="text-[11.5px] text-green-400 font-medium">Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3" />
                <span className="text-[11.5px]">Copy answer</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
