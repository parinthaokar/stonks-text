"use client";

import { useEffect, useRef } from "react";

/**
 * Pins a thread to its newest message.
 *
 * The two cases need different behaviour, which is the whole reason this isn't
 * a one-liner:
 *
 *   - OPENING a thread jumps instantly. Smooth-scrolling through a year of
 *     backlog would take seconds and look broken.
 *   - ADVANCING THE DAY in a thread you're already reading scrolls smoothly, so
 *     you can see that new bubbles arrived rather than being teleported and
 *     left to work out what changed.
 *
 * Tracked with refs rather than state: this reads the DOM and nothing renders
 * from it, so state would only cause an extra render.
 */
export function ScrollToBottom({ ticker, dep }: { ticker: string; dep: string }) {
  const previousTicker = useRef<string | null>(null);

  useEffect(() => {
    const el = document.getElementById("thread-scroll");
    if (!el) return;

    const isSameThread = previousTicker.current === ticker;
    previousTicker.current = ticker;

    // Honour the OS setting; a smooth scroll is motion the user opted out of.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: isSameThread && !reduced ? "smooth" : "auto",
    });
  }, [ticker, dep]);

  return null;
}
