/**
 * Client for the Modal-hosted recommendation engine.
 *
 * The URL comes from NEXT_PUBLIC_MODAL_API_URL because the browser calls the
 * service directly -- there is no Next.js route in between, and that prefix is
 * what exposes the value client-side.
 *
 * There is deliberately no localhost fallback. Defaulting to http://localhost:8000
 * would let a deployed build appear to work while quietly calling a machine that
 * isn't there. Missing configuration fails loudly instead.
 */

import type { Bar } from "./messages/rules";
import type { DayContext } from "./messages/rules";

export const RECOMMEND_API_URL = process.env.NEXT_PUBLIC_MODAL_API_URL ?? "";

export interface RecommendRequest {
  pct_change: number;
  volume_ratio: number;
  vol_20d: number;
  ma50_dist: number;
  drawdown_pct: number;
  is_52w_high: number;
  is_52w_low: number;
  down_streak: number;
  up_streak: number;
  is_crypto: number;
}

export interface TrackRecord {
  holdout_accuracy: number;
  majority_baseline: number;
  beats_baseline: boolean;
  note: string;
}

export interface RecommendResponse {
  action: "buy" | "hold" | "sell";
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
  track_record: TrackRecord;
}

export class RecommendError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RecommendError";
  }
}

export async function fetchRecommendation(body: RecommendRequest): Promise<RecommendResponse> {
  if (!RECOMMEND_API_URL) {
    throw new RecommendError("NEXT_PUBLIC_MODAL_API_URL is not set.", 0);
  }

  const res = await fetch(`${RECOMMEND_API_URL}/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // A 422 carries Pydantic's field-level detail, which is far more useful than
    // "request failed" when a feature is computed wrongly.
    let detail = `${res.status} ${res.statusText}`;
    try {
      const parsed = await res.json();
      if (Array.isArray(parsed?.detail) && parsed.detail.length > 0) {
        const first = parsed.detail[0];
        detail = `${first.loc?.at(-1) ?? "field"}: ${first.msg}`;
      } else if (typeof parsed?.detail?.message === "string") {
        detail = parsed.detail.message;
      }
    } catch {
      // Non-JSON body; the status line is all there is.
    }
    throw new RecommendError(detail, res.status);
  }

  return (await res.json()) as RecommendResponse;
}

/**
 * Assemble the model's ten inputs for one day.
 *
 * Seven come straight from the rules engine's own indicator pass, so the model
 * sees exactly what the messages were generated from. The remaining three --
 * realised volatility, distance from the 50-day average, and the crypto flag --
 * are derived here rather than added to `rules.ts`, which has no use for them;
 * putting them there would grow the message engine for a consumer that isn't it.
 *
 * Every window looks strictly backwards, matching how the model was trained.
 */
export function buildRecommendRequest(
  bars: Bar[],
  context: DayContext,
  isCrypto: boolean,
): RecommendRequest {
  const index = bars.findLastIndex((b) => b.date <= context.date);

  // Annualised 20-day realised volatility.
  let vol20d = 30;
  if (index >= 20) {
    const returns: number[] = [];
    for (let i = index - 19; i <= index; i++) {
      if (bars[i - 1]?.close > 0) {
        returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
      }
    }
    if (returns.length > 1) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance =
        returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
      vol20d = Math.sqrt(variance) * Math.sqrt(252) * 100;
    }
  }

  // Distance from the 50-day moving average, in percent.
  let ma50Dist = 0;
  if (index >= 49) {
    let sum = 0;
    for (let i = index - 49; i <= index; i++) sum += bars[i].close;
    const ma = sum / 50;
    if (ma > 0) ma50Dist = (bars[index].close / ma - 1) * 100;
  }

  // Clamped to the API's declared bounds. The server validates anyway -- this
  // just means a freak input produces a prediction instead of a 422 the user
  // can do nothing about.
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  return {
    pct_change: clamp(context.pctChange, -100, 100),
    volume_ratio: clamp(context.volumeRatio, 0, 50),
    vol_20d: clamp(vol20d, 0, 500),
    ma50_dist: clamp(ma50Dist, -100, 100),
    drawdown_pct: clamp(context.drawdownPct, 0, 100),
    is_52w_high: context.isNew52wHigh ? 1 : 0,
    is_52w_low: context.isNew52wLow ? 1 : 0,
    down_streak: clamp(Math.round(context.downStreak), 0, 60),
    up_streak: clamp(Math.round(context.upStreak), 0, 60),
    is_crypto: isCrypto ? 1 : 0,
  };
}
