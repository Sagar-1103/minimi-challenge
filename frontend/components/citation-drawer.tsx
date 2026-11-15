"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Globe, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";
import type { Citation } from "../lib/types";

interface CitationDrawerProps {
  citations: Citation[];
}

export function CitationDrawer({ citations }: CitationDrawerProps) {
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
  const carouselRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = carouselRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = carouselRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => checkScroll());
    observer.observe(el);
    return () => observer.disconnect();
  }, [checkScroll]);

  const scroll = (direction: "left" | "right") => {
    if (!carouselRef.current) return;
    const scrollAmount = Math.max(carouselRef.current.clientWidth * 0.7, 240);
    carouselRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  };

  if (!citations || citations.length === 0) return null;

  return (
    <div className="my-2 select-none relative group/sources">
      {/* Sleek Sources Header with Count & Navigation Arrows */}
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-wider uppercase text-white/50">
            Sources
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/40">
            {citations.length}
          </span>
        </div>

        {/* Quick horizontal scroll arrow controls */}
        <div className="flex items-center gap-1 opacity-0 group-hover/sources:opacity-100 transition-opacity duration-150">
          <button
            type="button"
            onClick={() => scroll("left")}
            disabled={!canScrollLeft}
            className="size-5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
            title="Scroll left"
            aria-label="Scroll sources left"
          >
            <ChevronLeft className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => scroll("right")}
            disabled={!canScrollRight}
            className="size-5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
            title="Scroll right"
            aria-label="Scroll sources right"
          >
            <ChevronRight className="size-3" />
          </button>
        </div>
      </div>

      {/* Horizontal Carousel of Source Cards with sleek visible horizontal scrollbar */}
      <div
        ref={carouselRef}
        onScroll={checkScroll}
        className="flex items-center gap-2.5 overflow-x-auto pb-2 pt-0.5 -mx-1 px-1 sources-scroller"
      >
          {citations.map((c) => {
            const hasImgError = imgErrors[c.index];
            const faviconUrl = c.domain
              ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
                  c.domain
                )}&sz=32`
              : null;

            return (
              <a
                key={c.index}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                title={c.title || c.snippet || c.url}
                className="flex flex-col justify-between w-44 min-w-[176px] h-[76px] p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/25 shadow-xs transition-all duration-150 group shrink-0 select-none text-left"
              >
                {/* Header: Favicon + Domain + Index Pill */}
                <div className="flex items-center justify-between gap-1.5 w-full">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {faviconUrl && !hasImgError ? (
                      <img
                        src={faviconUrl}
                        alt=""
                        className="size-3.5 rounded-xs shrink-0 opacity-80 group-hover:opacity-100"
                        onError={() =>
                          setImgErrors((prev) => ({ ...prev, [c.index]: true }))
                        }
                      />
                    ) : (
                      <Globe className="size-3.5 text-blue-400/80 shrink-0" />
                    )}
                    <span className="text-[11px] font-medium text-white/60 group-hover:text-white/90 truncate">
                      {c.domain || "source"}
                    </span>
                    {c.authoritative && (
                      <ShieldCheck className="size-3 text-blue-400 shrink-0" />
                    )}
                  </div>

                  <span className="text-[10px] text-white/40 font-mono size-4 rounded-full bg-white/[0.06] group-hover:bg-white/10 group-hover:text-white/80 flex items-center justify-center shrink-0">
                    {c.index}
                  </span>
                </div>

                {/* Title / Snippet */}
                <p className="text-[11.5px] leading-snug text-white/75 group-hover:text-white/95 line-clamp-2 font-normal">
                  {c.title || c.snippet || c.domain}
                </p>
              </a>
            );
          })}
        </div>
    </div>
  );
}
