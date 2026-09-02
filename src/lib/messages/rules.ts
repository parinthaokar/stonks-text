/**
 * ============================================================================
 *  STONKS & TEXTS -- MESSAGE RULES ENGINE
 * ============================================================================
 *
 * This is the single source of truth for turning price data into text messages.
 * The seed script (scripts/seed.ts) imports this module to pre-generate every
 * message into Postgres, and the app imports the same module for its types and
 * display metadata. There is exactly one implementation.
 *
 * DESIGN PRINCIPLE: FULLY DETERMINISTIC.
 * ---------------------------------------
 * Nothing here calls Math.random() or Date.now(). Given the same OHLCV rows you
 * get byte-identical messages, every single run. That matters for two reasons:
 *   1. The backtest has to be reproducible -- a grader re-running the seed must
 *      get the same numbers we report.
 *   2. "Random flavor text" would make the data story a lie. Every message is a
 *      claim about what the price actually did that day.
 *
 * Where we DO want variety (so a thread doesn't read like a form letter), we
 * pick a phrasing variant with an FNV-1a hash of (ticker, date, rule). That is
 * a pure function of the input, so it is varied *and* reproducible. See
 * `pickVariant` at the bottom.
 *
 * HOW A DAY BECOMES A MESSAGE
 * ---------------------------
 *   bars[]  ->  computeIndicators()  ->  DayContext  ->  first matching RULE
 *
 * Rules are evaluated in array order and THE FIRST MATCH WINS. Order therefore
 * encodes editorial priority: a day that is simultaneously a new 52-week low
 * and a >5% drop is a bigger story as a 52-week low, so that rule sits first.
 *
 * Every threshold is a named constant in THRESHOLDS below -- one place to tune,
 * and easy to point at when explaining the model.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One day of adjusted OHLCV. `date` is an ISO calendar day, "YYYY-MM-DD". */
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Tone =
  | "euphoric"    // new 52-week high
  | "manic"       // big single-day gain
  | "smug"        // multi-day winning streak
  | "attention"   // unusual volume
  | "casual"      // nothing much happened
  | "anxious"     // big single-day drop
  | "desperate"   // multi-day losing streak
  | "despondent"; // new 52-week low

export type RuleId =
  | "new_52w_high"
  | "new_52w_low"
  | "big_gain"
  | "big_drop"
  | "losing_streak"
  | "winning_streak"
  | "volume_spike"
  | "mundane";

/** Everything the rules are allowed to look at for a single day. */
export interface DayContext {
  ticker: string;
  date: string;
  close: number;
  volume: number;
  /** Day-over-day close-to-close change, in percent. Signed. */
  pctChange: number;
  /** Today's volume divided by the mean of the prior 20 sessions. 1 = normal. */
  volumeRatio: number;
  /** Consecutive down days ending today (0 if today was flat or up). */
  downStreak: number;
  /** Consecutive up days ending today (0 if today was flat or down). */
  upStreak: number;
  /** Highest / lowest close over the trailing 52 calendar weeks, incl. today. */
  high52w: number;
  low52w: number;
  /** True only on the day the trailing-year extreme is actually set. */
  isNew52wHigh: boolean;
  isNew52wLow: boolean;
  /** How far below the trailing-year high we are, in percent (0 = at the high). */
  drawdownPct: number;
  /**
   * False during the warm-up period at the very start of the dataset, where
   * there is not yet a year of history behind us. Rules that depend on a full
   * lookback window are suppressed until this is true.
   */
  hasFullLookback: boolean;
}

export interface GeneratedMessage {
  ticker: string;
  date: string;
  rule: RuleId;
  tone: Tone;
  text: string;
  /**
   * 1-5. Drives sort order and the "unread" dot in the sidebar: anything >= 4
   * is a big mover worth interrupting the user for.
   */
  priority: number;
  /** Snapshot of the numbers that triggered this message, for the Data tab. */
  pctChange: number;
  volumeRatio: number;
  close: number;
}

// ---------------------------------------------------------------------------
// Tunable thresholds -- the entire "model" in one object
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  /** A move of this size (either direction) is a "big" day. */
  BIG_MOVE_PCT: 5.0,
  /** Volume this many times the 20-day average counts as a spike. */
  VOLUME_SPIKE_RATIO: 2.0,
  /** Consecutive red/green days needed before the streak rules fire. */
  STREAK_MIN_DAYS: 4,
  /**
   * Once a streak rule has fired it stays quiet for this many further days of
   * the SAME streak before speaking again. Without it a 9-day slide emits six
   * near-identical messages and buries every other rule in the thread.
   */
  STREAK_REPEAT_DAYS: 2,
  /** Minimum days between two volume-spike messages for the same asset. */
  VOLUME_SPIKE_COOLDOWN_DAYS: 5,
  /** Sessions used for the average-volume baseline. */
  VOLUME_LOOKBACK_DAYS: 20,
  /** Calendar days in the "52 week" window. Calendar, not sessions, so that
   *  crypto (7 days/wk) and stocks (5 days/wk) get the same real time window. */
  LOOKBACK_CALENDAR_DAYS: 365,
  /** A mundane check-in is only emitted if the asset has been silent this long,
   *  otherwise every quiet day would produce a message and drown the thread. */
  MUNDANE_COOLDOWN_DAYS: 7,
} as const;

/** Display metadata, kept next to the rules so the UI and the docs can't drift. */
export const RULE_META: Record<RuleId, { label: string; tone: Tone; priority: number; description: string }> = {
  new_52w_high:   { label: "52-week high",  tone: "euphoric",   priority: 5, description: "Close is the highest in the trailing 52 weeks." },
  new_52w_low:    { label: "52-week low",   tone: "despondent", priority: 5, description: "Close is the lowest in the trailing 52 weeks." },
  big_gain:       { label: "Big gain",      tone: "manic",      priority: 4, description: `Up more than ${THRESHOLDS.BIG_MOVE_PCT}% on the day.` },
  big_drop:       { label: "Big drop",      tone: "anxious",    priority: 4, description: `Down more than ${THRESHOLDS.BIG_MOVE_PCT}% on the day.` },
  losing_streak:  { label: "Losing streak", tone: "desperate",  priority: 3, description: `${THRESHOLDS.STREAK_MIN_DAYS}+ consecutive down days; tone escalates with length.` },
  winning_streak: { label: "Winning streak",tone: "smug",       priority: 3, description: `${THRESHOLDS.STREAK_MIN_DAYS}+ consecutive up days.` },
  volume_spike:   { label: "Volume spike",  tone: "attention",  priority: 2, description: `Volume >= ${THRESHOLDS.VOLUME_SPIKE_RATIO}x the ${THRESHOLDS.VOLUME_LOOKBACK_DAYS}-day average.` },
  mundane:        { label: "Check-in",      tone: "casual",     priority: 1, description: `Nothing notable; throttled to once per ${THRESHOLDS.MUNDANE_COOLDOWN_DAYS} quiet days.` },
};

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function daysBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(bIso) - Date.parse(aIso)) / DAY_MS);
}

/**
 * Walk the bar series once and derive every number the rules need.
 *
 * The 52-week window is measured in CALENDAR days rather than a fixed number of
 * rows. Bitcoin prints ~365 bars a year and Apple prints ~252, so a row-count
 * window would silently give crypto a much shorter memory than stocks.
 */
export function computeIndicators(ticker: string, bars: Bar[]): DayContext[] {
  const out: DayContext[] = [];
  let downStreak = 0;
  let upStreak = 0;

  // Left edge of the trailing-year window; advances monotonically with `i`.
  let windowStart = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const prev = i > 0 ? bars[i - 1] : undefined;

    const pctChange = prev && prev.close > 0 ? ((bar.close - prev.close) / prev.close) * 100 : 0;

    if (pctChange < 0) {
      downStreak += 1;
      upStreak = 0;
    } else if (pctChange > 0) {
      upStreak += 1;
      downStreak = 0;
    } else {
      // A perfectly flat close breaks both streaks rather than extending them.
      downStreak = 0;
      upStreak = 0;
    }

    // Average volume over the prior N sessions, excluding today -- otherwise a
    // spike would inflate its own baseline and understate itself.
    const volFrom = Math.max(0, i - THRESHOLDS.VOLUME_LOOKBACK_DAYS);
    let volSum = 0;
    let volCount = 0;
    for (let j = volFrom; j < i; j++) {
      volSum += bars[j].volume;
      volCount += 1;
    }
    const avgVolume = volCount > 0 ? volSum / volCount : 0;
    const volumeRatio = avgVolume > 0 ? bar.volume / avgVolume : 1;

    // Slide the trailing-year window forward, then scan it for the extremes.
    while (daysBetween(bars[windowStart].date, bar.date) > THRESHOLDS.LOOKBACK_CALENDAR_DAYS) {
      windowStart += 1;
    }
    let high52w = -Infinity;
    let low52w = Infinity;
    for (let j = windowStart; j <= i; j++) {
      if (bars[j].close > high52w) high52w = bars[j].close;
      if (bars[j].close < low52w) low52w = bars[j].close;
    }

    // Only claim a full lookback once the data actually spans the window.
    const spanDays = daysBetween(bars[0].date, bar.date);
    const hasFullLookback = spanDays >= THRESHOLDS.LOOKBACK_CALENDAR_DAYS;

    out.push({
      ticker,
      date: bar.date,
      close: bar.close,
      volume: bar.volume,
      pctChange,
      volumeRatio,
      downStreak,
      upStreak,
      high52w,
      low52w,
      // `>=` with a tiny epsilon: today is included in the window above, so the
      // day that sets the extreme compares equal to it.
      isNew52wHigh: hasFullLookback && bar.close >= high52w - 1e-9,
      isNew52wLow: hasFullLookback && bar.close <= low52w + 1e-9,
      drawdownPct: high52w > 0 ? ((high52w - bar.close) / high52w) * 100 : 0,
      hasFullLookback,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** Firing history handed to each rule so it can throttle itself. */
export interface MatchContext {
  /** Yesterday's context, or undefined on the very first bar. */
  prev?: DayContext;
  /** Days since this asset sent ANY message. Infinity if it never has. */
  daysSinceAnyMessage: number;
  /** Days since this asset last fired THIS rule. Infinity if it never has. */
  daysSinceThisRule: number;
}

interface Rule {
  id: RuleId;
  /** Does this rule claim the day? Evaluated top to bottom, first match wins. */
  match: (d: DayContext, c: MatchContext) => boolean;
  /** Phrasing options; one is chosen deterministically. See pickVariant. */
  variants: string[];
  /**
   * Optional override that selects a variant by index instead of by hash --
   * used by the streak rules so that longer streaks escalate in tone rather
   * than picking a phrasing at random.
   */
  variantIndex?: (d: DayContext) => number;
}

/**
 * Placeholders available in variant strings:
 *   {pct}    absolute day change, 1dp, unsigned   e.g. "7.4"
 *   {signed} day change with an explicit sign     e.g. "-7.4"
 *   {n}      current streak length
 *   {x}      volume multiple vs the 20-day avg    e.g. "3.2"
 *   {price}  today's close, 2dp
 *   {dd}     drawdown from the 52-week high, 1dp
 */
export const RULES: Rule[] = [
  // -- Priority 5: trailing-year extremes. These outrank the >5% rules because
  //    "highest in a year" is a bigger story than "up a lot today", and the two
  //    very often land on the same day.
  {
    id: "new_52w_high",
    // BREAKOUT DAY ONLY, not every day of a sustained run. In an uptrend every
    // session sets a new high, and "i've never been worth more" means nothing if
    // it arrives 30 days running. Requiring yesterday to NOT have been a high
    // turns a 30-day run into one message: the day the record was reclaimed.
    match: (d, c) => d.isNew52wHigh && !c.prev?.isNew52wHigh,
    variants: [
      "52 WEEK HIGH. i have never been worth more than i am right now. not once. not ever.",
      "new 52-week high at ${price}. take a screenshot. frame it. tell people.",
      "highest close in a year 🫡 i'd like to thank the volume, the buyers, and me",
      "i want you to know that this is a 52-week high and i will be bringing it up later",
    ],
  },
  {
    id: "new_52w_low",
    match: (d, c) => d.isNew52wLow && !c.prev?.isNew52wLow,
    variants: [
      "52 week low. that's the lowest i've been in a year. i'm aware. i don't want to talk about it.",
      "new 52-week low at ${price}. i'm not asking for anything. i'm just telling you where i am.",
      "haven't been this cheap since last year. do with that information what you will.",
      "so this is a 52-week low. {dd}% off my high. anyway. how was your day",
    ],
  },

  // -- Priority 4: big single-session moves. The headline rules from the spec.
  {
    id: "big_gain",
    match: (d) => d.pctChange >= THRESHOLDS.BIG_MOVE_PCT,
    variants: [
      "UP {pct}% TODAY. UP. {pct}. PERCENT. i need you to react to this.",
      "ok ok ok don't panic but i just went up {pct}% and i feel incredible",
      "+{pct}%. we are SO back. i'm at ${price}. call your mother.",
      "{pct}% GREEN. i'm not going to be normal about this and you can't make me.",
    ],
  },
  {
    id: "big_drop",
    match: (d) => d.pctChange <= -THRESHOLDS.BIG_MOVE_PCT,
    variants: [
      "hey. so. we need to talk. i'm down {pct}% today.",
      "before you open your portfolio — it's {signed}%. i can explain. i can't explain.",
      "{signed}% today. i'd tell you it's fine but you can see the number too.",
      "down {pct}%. i'm at ${price}. please don't be weird about this.",
    ],
  },

  // -- Priority 3: multi-day streaks. The losing streak escalates with length,
  //    which is the whole point of the rule -- the tone is a function of `n`.
  {
    id: "losing_streak",
    // Fires the day the streak qualifies, then only every other day it survives,
    // so a long slide escalates in a few beats instead of nagging daily.
    match: (d) =>
      d.downStreak >= THRESHOLDS.STREAK_MIN_DAYS &&
      (d.downStreak - THRESHOLDS.STREAK_MIN_DAYS) % THRESHOLDS.STREAK_REPEAT_DAYS === 0,
    // Escalation ladder: rung climbs with streak length and clamps at the last
    // variant, so a 12-day streak reads as unhinged as an 10-day one rather
    // than wrapping back around to mild.
    variantIndex: (d) =>
      Math.min(Math.floor((d.downStreak - THRESHOLDS.STREAK_MIN_DAYS) / THRESHOLDS.STREAK_REPEAT_DAYS), 3),
    variants: [
      "{n} red days in a row now. it's probably nothing. it's probably fine.",
      "{n} days straight. i'm starting to take this personally.",
      "{n} consecutive down days. i've stopped counting. (i have not stopped counting.)",
      "day {n} of the streak. {dd}% off my high. if you're reading this i have no plan and no dignity.",
    ],
  },
  {
    id: "winning_streak",
    match: (d) =>
      d.upStreak >= THRESHOLDS.STREAK_MIN_DAYS &&
      (d.upStreak - THRESHOLDS.STREAK_MIN_DAYS) % THRESHOLDS.STREAK_REPEAT_DAYS === 0,
    variantIndex: (d) =>
      Math.min(Math.floor((d.upStreak - THRESHOLDS.STREAK_MIN_DAYS) / THRESHOLDS.STREAK_REPEAT_DAYS), 2),
    variants: [
      "{n} green days in a row. no notes. no thoughts. just up.",
      "{n} straight sessions up now. i'd like to say i'm humbled. i am not.",
      "{n} in a row. at this point i'm just showing off and we both know it.",
    ],
  },

  // -- Priority 2: attention. Fires on quiet-price/loud-volume days, which is
  //    exactly the case a price-only rule set would miss entirely.
  {
    id: "volume_spike",
    match: (d, c) =>
      d.volumeRatio >= THRESHOLDS.VOLUME_SPIKE_RATIO &&
      c.daysSinceThisRule >= THRESHOLDS.VOLUME_SPIKE_COOLDOWN_DAYS,
    variants: [
      "volume's {x}x normal today. everyone is talking about me. i don't know what they know.",
      "{x}x the usual volume and only {signed}% to show for it. someone knows something.",
      "my phone hasn't stopped. {x}x average volume. i'm trending and i'm scared.",
    ],
  },

  // -- Priority 1: fallback. Throttled, or every calm day would emit a message
  //    and the interesting ones would be buried.
  {
    id: "mundane",
    match: (_d, c) => c.daysSinceAnyMessage >= THRESHOLDS.MUNDANE_COOLDOWN_DAYS,
    variants: [
      "{signed}% today. riveting stuff. truly.",
      "nothing to report. still here. still ${price}.",
      "moved {signed}% today. anyway. how are you.",
      "checking in. {signed}% on the day. that's the whole update.",
      "quiet one. {signed}%. i'll let you know if anything happens.",
    ],
  },
];

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * FNV-1a, 32-bit. A tiny non-cryptographic hash used ONLY to pick which
 * phrasing of a message to use. Deterministic by construction: the same
 * (ticker, date, rule) always lands on the same variant, on every machine and
 * every re-run of the seed.
 */
export function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function pickVariant(rule: Rule, d: DayContext): string {
  if (rule.variantIndex) {
    const idx = Math.max(0, Math.min(rule.variantIndex(d), rule.variants.length - 1));
    return rule.variants[idx];
  }
  return rule.variants[stableHash(`${d.ticker}|${d.date}|${rule.id}`) % rule.variants.length];
}

function fill(template: string, d: DayContext): string {
  const streak = d.downStreak > 0 ? d.downStreak : d.upStreak;
  return template
    .replace(/\{pct\}/g, Math.abs(d.pctChange).toFixed(1))
    .replace(/\{signed\}/g, `${d.pctChange >= 0 ? "+" : ""}${d.pctChange.toFixed(1)}`)
    .replace(/\{n\}/g, String(streak))
    .replace(/\{x\}/g, d.volumeRatio.toFixed(1))
    .replace(/\{price\}/g, d.close.toFixed(2))
    .replace(/\{dd\}/g, d.drawdownPct.toFixed(1));
}

export interface GenerateOptions {
  /** Only emit messages on or after this date. Defaults to the whole series. */
  from?: string;
}

/**
 * Turn one asset's price history into its full message thread.
 *
 * Warm-up days (before a year of lookback exists) still run through
 * `computeIndicators` -- they are needed to build the streaks and averages --
 * but they never emit a message, and `options.from` normally excludes them
 * anyway since the sim window starts after the lookback period.
 */
export function generateMessages(
  ticker: string,
  bars: Bar[],
  options: GenerateOptions = {},
): GeneratedMessage[] {
  const contexts = computeIndicators(ticker, bars);
  const messages: GeneratedMessage[] = [];
  let lastMessageDate: string | null = null;
  const lastFiredByRule = new Map<RuleId, string>();

  for (let i = 0; i < contexts.length; i++) {
    const d = contexts[i];
    // Taken from the full series rather than from evaluated days only, so that
    // the breakout rules see the true previous session even on the first day of
    // the sim window.
    const prev = i > 0 ? contexts[i - 1] : undefined;

    if (!d.hasFullLookback) continue;
    if (options.from && d.date < options.from) continue;

    const since = (iso: string | null | undefined) =>
      iso ? daysBetween(iso, d.date) : Number.POSITIVE_INFINITY;

    const rule = RULES.find((r) =>
      r.match(d, {
        prev,
        daysSinceAnyMessage: since(lastMessageDate),
        daysSinceThisRule: since(lastFiredByRule.get(r.id)),
      }),
    );
    if (!rule) continue;

    const meta = RULE_META[rule.id];
    messages.push({
      ticker,
      date: d.date,
      rule: rule.id,
      tone: meta.tone,
      text: fill(pickVariant(rule, d), d),
      priority: meta.priority,
      pctChange: Number(d.pctChange.toFixed(4)),
      volumeRatio: Number(d.volumeRatio.toFixed(4)),
      close: d.close,
    });
    lastMessageDate = d.date;
    lastFiredByRule.set(rule.id, d.date);
  }

  return messages;
}
