"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface MarkdownTableProps {
  children: React.ReactNode;
}

export function MarkdownTable({ children }: MarkdownTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = containerRef.current;
    if (!el) return;

    // Use ResizeObserver for accurate detection when table data loads or window resizes
    const observer = new ResizeObserver(() => checkScroll());
    observer.observe(el);

    return () => observer.disconnect();
  }, [checkScroll]);

  const scroll = (direction: "left" | "right") => {
    if (!containerRef.current) return;
    const scrollAmount = Math.max(containerRef.current.clientWidth * 0.6, 220);
    containerRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  return (
    <div className="relative my-4 group/table select-text rounded-xl border border-white/[0.08] overflow-hidden bg-[#0D1017]/95 shadow-md">
      {/* Scrollable Container with Max Height & Horizontal Overflow */}
      <div
        ref={containerRef}
        onScroll={checkScroll}
        className="w-full overflow-auto max-h-[520px] table-scroll-container"
      >
        <table className="w-full text-left text-xs border-collapse min-w-[560px]">
          {children}
        </table>
      </div>

      {/* Top-right corner filler to seamlessly connect the header background and divider to the right border */}
      <div className="absolute top-0 right-0 h-[39px] w-4 bg-[#0E121A] border-b border-white/[0.08] pointer-events-none z-10" />

      {/* Left scroll chevron button (centered in the table body) */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute left-2.5 top-[calc(50%+20px)] -translate-y-1/2 size-7 rounded-full bg-[#161B26]/90 hover:bg-[#1E2536] border border-white/20 text-white/80 hover:text-white flex items-center justify-center shadow-xl backdrop-blur-md opacity-0 group-hover/table:opacity-100 transition-all duration-150 active:scale-95 cursor-pointer z-20"
          title="Scroll left"
          aria-label="Scroll table left"
        >
          <ChevronLeft className="size-4" />
        </button>
      )}

      {/* Right scroll chevron button (centered in the table body) */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll("right")}
          className="absolute right-2.5 top-[calc(50%+20px)] -translate-y-1/2 size-7 rounded-full bg-[#161B26]/90 hover:bg-[#1E2536] border border-white/20 text-white/80 hover:text-white flex items-center justify-center shadow-xl backdrop-blur-md opacity-0 group-hover/table:opacity-100 transition-all duration-150 active:scale-95 cursor-pointer z-20"
          title="Scroll right"
          aria-label="Scroll table right"
        >
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  );
}
