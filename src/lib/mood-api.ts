/**
 * Client for the Modal-hosted mood engine.
 *
 * The URL comes from NEXT_PUBLIC_MODAL_API_URL because the browser calls this
 * service directly -- there is no Next.js route in between. That prefix is what
 * makes the value available client-side; without it the variable is undefined in
 * the browser and every request silently goes to the current origin.
 *
 * There is deliberately no localhost fallback. A default of
 * http://localhost:8000 would let a deployed build look like it worked while
 * quietly calling a machine that isn't there -- the exact failure the
 * assignment warns about. Missing config fails loudly instead.
 */

export const MOOD_API_URL = process.env.NEXT_PUBLIC_MODAL_API_URL ?? "";

export interface MoodRequest {
  pct_change: number;
  volume_ratio: number;
  down_streak: number;
  up_streak: number;
  drawdown_pct: number;
  is_52w_high: number;
  is_52w_low: number;
}

export interface MoodNeighbor {
  ticker: string;
  date: string;
  tone: string;
  pct_change: number;
  volume_ratio: number;
  distance: number;
}

export interface MoodResponse {
  tone: string;
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
  example_message: string;
  nearest_days: MoodNeighbor[];
}

export interface PipelineInfo {
  name: string;
  steps: string[];
  built_at: string;
  sklearn_version: string;
  python_version: string;
  custom_transformer: string;
  n_training_rows: number;
  raw_features: string[];
  engineered_features: string[];
  classes: string[];
  holdout_accuracy: number;
  holdout_macro_f1: number;
  majority_baseline: number;
  n_indexed_days: number;
  n_example_messages: number;
}

export class MoodApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "MoodApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!MOOD_API_URL) {
    throw new MoodApiError("NEXT_PUBLIC_MODAL_API_URL is not set.", 0);
  }

  const res = await fetch(`${MOOD_API_URL}${path}`, init);

  if (!res.ok) {
    // 422 carries Pydantic's field-level detail; surfacing the first one is far
    // more useful than "request failed".
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (Array.isArray(body?.detail) && body.detail.length > 0) {
        const first = body.detail[0];
        detail = `${first.loc?.at(-1) ?? "field"}: ${first.msg}`;
      } else if (typeof body?.detail?.message === "string") {
        detail = body.detail.message;
      }
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new MoodApiError(detail, res.status);
  }

  return (await res.json()) as T;
}

export function getPipelineInfo(): Promise<PipelineInfo> {
  return call<PipelineInfo>("/pipeline");
}

export function predictMood(body: MoodRequest): Promise<MoodResponse> {
  return call<MoodResponse>("/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
