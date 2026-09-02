"use client";

import { useEffect } from "react";

/**
 * Pins a thread to its newest message. A chat reads bottom-up, and jumping the
 * user to the top of a year of history every navigation would be unusable.
 * Keyed on `dep` so it re-pins when the thread or the sim date changes.
 */
export function ScrollToBottom({ dep }: { dep: string }) {
  useEffect(() => {
    const el = document.getElementById("thread-scroll");
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return null;
}
