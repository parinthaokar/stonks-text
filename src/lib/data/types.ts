/** Shared row shapes for the app, independent of where the data comes from. */

export type AssetType = "stock" | "crypto";
export type TradeAction = "buy" | "sell" | "hold";

export interface Asset {
  id: number;
  ticker: string;
  name: string;
  type: AssetType;
  category: string;
  color: string;
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Message {
  id: number;
  assetId: number;
  ticker: string;
  date: string;
  rule: string;
  tone: string;
  body: string;
  priority: number;
  pctChange: number;
  volumeRatio: number;
  close: number;
}

export interface TradeRow {
  id: number;
  assetId: number;
  ticker: string;
  messageId: number | null;
  action: TradeAction;
  price: number;
  quantity: number;
  notional: number;
  tradeDate: string;
  createdAt: string;
}

export interface SimState {
  simDate: string;
  cash: number;
  startingCash: number;
}

export interface NewTrade {
  assetId: number;
  messageId: number | null;
  action: TradeAction;
  price: number;
  quantity: number;
  notional: number;
  tradeDate: string;
}

/**
 * Everything the app needs from storage. Implemented twice -- once against
 * Supabase (the real target) and once against the committed CSVs (so the app
 * runs from a fresh clone with no credentials). Both satisfy this interface,
 * so no page or component knows which one it is talking to.
 */
export interface DataSource {
  readonly kind: "supabase" | "local";
  getAssets(): Promise<Asset[]>;
  getPrices(): Promise<Record<string, PriceBar[]>>;
  getMessages(): Promise<Message[]>;
  getSimState(): Promise<SimState>;
  setSimState(next: Partial<SimState>): Promise<void>;
  getTrades(): Promise<TradeRow[]>;
  addTrade(trade: NewTrade): Promise<void>;
  resetSim(): Promise<void>;
}
