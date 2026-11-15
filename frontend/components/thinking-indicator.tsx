"use client";

import { useState } from "react";
import { ChevronDown, Globe, Search } from "lucide-react";
import type { ToolCallItem } from "../lib/types";

interface ThinkingIndicatorProps {
  statusText?: string;
  toolCalls?: ToolCallItem[];
  isStreaming?: boolean;
}

export function ThinkingIndicator({
  statusText,
  toolCalls = [],
  isStreaming = false,
}: ThinkingIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  const hasTools = toolCalls.length > 0;

  // When not streaming and no tools were queried (e.g. conversational prompt), hide indicator
  if (!isStreaming && !hasTools) {
    return null;
  }

  const queryCount = toolCalls.length;
  const label = isStreaming
    ? statusText || "Searching & analyzing..."
    : `Searched ${queryCount} ${queryCount === 1 ? "query" : "queries"}`;

  return (
    <div className="my-2 select-none">
      <button
        type="button"
        onClick={() => hasTools && setExpanded(!expanded)}
        className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11.5px] transition-all duration-150 active:scale-[0.98] cursor-pointer border ${
          isStreaming
            ? "bg-white/[0.05] border-white/10 text-white/80"
            : "bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.08] text-white/50 hover:text-white/80"
        }`}
      >
        {isStreaming ? (
          <span className="size-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
        ) : (
          <Search className="size-3 text-white/40 shrink-0" />
        )}
        <span className="font-normal">{label}</span>
        {hasTools && (
          <span className="flex items-center ml-0.5">
            <ChevronDown
              className={`size-3 text-white/40 transition-transform duration-200 ease-out ${
                expanded ? "rotate-0" : "-rotate-90"
              }`}
            />
          </span>
        )}
      </button>

      {/* Smooth accordion dropdown for tool queries */}
      {hasTools && (
        <div
          className={`grid overflow-hidden transition-all duration-200 ease-out ${
            expanded
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          }`}
          style={{
            gridTemplateRows: expanded ? "1fr" : "0fr",
            marginTop: expanded ? "10px" : "0px",
            transition:
              "grid-template-rows 250ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease-out, margin-top 200ms ease-out",
          }}
        >
          <div className="overflow-hidden">
            <div className="ml-1 pl-3 border-l border-white/10 space-y-1.5 py-1">
              {toolCalls.map((tool, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 text-[11.5px] text-white/60"
                >
                  <Globe className="size-3 text-blue-400/80 shrink-0" />
                  <span className="text-white/80 truncate max-w-lg font-mono text-[11px]">
                    "{tool.query}"
                  </span>
                  {tool.resultCount != null && (
                    <span className="text-white/35 text-[10px]">
                      · {tool.resultCount} results
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
