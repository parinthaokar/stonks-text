/**
 * Reads the numbers the landing page quotes.
 *
 * These come from `npm run backtest`, which writes data/backtest.json. Reading
 * them from disk rather than typing them into the copy means the marketing
 * claim and the model can never drift apart -- refresh the data, re-run the
 * backtest, and the headline updates itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface StrategyStat {
  endValue: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  sharpe: number;
  filledTrades: number;
}

export interface BacktestStats {
  generated_at: string;
  window: { from: string; to: string };
  assets: number;
  messages: number;
  starting_cash: number;
  bet_size: number;
  execution: string;
  strategies: Record<string, StrategyStat>;
}

export function loadBacktestStats(): BacktestStats | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "data", "backtest.json"), "utf8")) as BacktestStats;
  } catch {
    // The landing page degrades to its non-numeric copy rather than failing the
    // build if the backtest hasn't been run yet.
    return null;
  }
}
