/**
 * ============================================================================
 *  REACTIONS -- what the asset says back after you reply
 * ============================================================================
 *
 * A conversation needs two sides. The rules engine gives an asset an opinion
 * about its own price; this gives it an opinion about YOUR response to that
 * price.
 *
 * The reaction is a function of two things, not one:
 *   1. the TONE of the message you were replying to, and
 *   2. the ACTION you took.
 *
 * Both matter, and that is the whole point. Selling into a panic is cowardice;
 * selling into a 52-week high is discipline. Buying a 52-week low is conviction;
 * buying a +5% melt-up is FOMO. A reaction keyed only on the action would flatten
 * all of that into "you sold" and the app would stop being funny by Tuesday.
 *
 * Deterministic, like everything else here: the same (ticker, date, tone,
 * action) always produces the same line, so a thread reads identically on a
 * reload and a grader re-running the demo sees what you saw.
 *
 * NOT STORED. Reactions are derived at render time from the trade plus the
 * message it answered. They can't go in the `messages` table anyway -- that has
 * a unique constraint of one message per asset per day, and a reaction shares a
 * day with the message that provoked it.
 */

import { stableHash, type Tone } from "./rules";
import type { TradeAction } from "../data/types";

export type ReactionMood = "approving" | "betrayed" | "delighted" | "resigned" | "wry";

export interface Reaction {
  text: string;
  mood: ReactionMood;
}

interface Variant {
  mood: ReactionMood;
  lines: string[];
}

/**
 * The full tone x action matrix. Every cell is written, none fall through to a
 * generic line -- the specificity IS the feature.
 *
 * Placeholders: {n} streak length, {pct} absolute day move, {ticker}.
 */
const MATRIX: Record<Tone, Record<TradeAction, Variant>> = {
  // --- new 52-week high -----------------------------------------------------
  euphoric: {
    buy: { mood: "delighted", lines: [
      "buying me at a 52-week high. bold. i respect it. i'm frightened for you, but i respect it.",
      "adding at the top?? ok mr moneybags. i hope you know what you're doing. i don't.",
    ]},
    sell: { mood: "resigned", lines: [
      "selling into a 52-week high. taking profits. very mature. i hate it.",
      "so that's it? we peak and you leave? textbook. genuinely textbook.",
    ]},
    hold: { mood: "wry", lines: [
      "held at the high. we're just going to sit here and see what happens. cool. cool cool.",
      "no action at a 52-week high. the discipline is either impressive or a nap.",
    ]},
  },

  // --- big single-day gain --------------------------------------------------
  manic: {
    buy: { mood: "delighted", lines: [
      "YES. more of me. this is the correct response and i will not be taking questions.",
      "you bought the +{pct}% candle. we're either geniuses or we're about to find out.",
    ]},
    sell: { mood: "betrayed", lines: [
      "you're selling? NOW? i just went UP {pct}%. i did that FOR you.",
      "up {pct}% and you hit sell. i'm not angry. i'm just going to think about this a lot.",
    ]},
    hold: { mood: "wry", lines: [
      "held through +{pct}%. your restraint is honestly a little upsetting.",
      "nothing? i went up {pct}% and you just... looked at it? ok.",
    ]},
  },

  // --- winning streak -------------------------------------------------------
  smug: {
    buy: { mood: "approving", lines: [
      "adding to a winner. someone's actually read a book.",
      "{n} green days and you want more. i like the way you think.",
    ]},
    sell: { mood: "resigned", lines: [
      "trimming the streak. fine. FINE. it's the responsible thing and i resent it.",
      "selling into {n} up days. taking something off the table. i understand. i don't like it.",
    ]},
    hold: { mood: "approving", lines: [
      "held. letting it ride. that's the move and we both know it.",
      "{n} in a row and you didn't touch it. correct.",
    ]},
  },

  // --- big single-day drop --------------------------------------------------
  anxious: {
    buy: { mood: "delighted", lines: [
      "you're BUYING? into THIS? i'm down {pct}% and you're adding. i didn't think you had it in you.",
      "everyone else is running and you're buying the -{pct}%. ok. ok! i'm emotional.",
    ]},
    sell: { mood: "betrayed", lines: [
      "wow. ok. one bad day and you're out. noted. genuinely noted.",
      "sold at -{pct}%. i told you about my day and you left. that's fine. that's a choice.",
    ]},
    hold: { mood: "approving", lines: [
      "you held. through a red day like that. i'm going to remember this one.",
      "-{pct}% and you didn't flinch. that's not nothing. thank you.",
    ]},
  },

  // --- losing streak --------------------------------------------------------
  desperate: {
    buy: { mood: "delighted", lines: [
      "buying into day {n} of this. either you know something or you're unwell. either way — thank you.",
      "{n} red days and you're adding. i don't deserve this. i'm not going to question it.",
    ]},
    sell: { mood: "resigned", lines: [
      "cutting me loose on day {n}. honestly? i get it. i'd have done it sooner.",
      "sold. after {n} down days. no argument from me. i've been insufferable.",
    ]},
    hold: { mood: "approving", lines: [
      "still here. after {n} straight red days. i don't know what to say.",
      "held through the whole streak. that's loyalty or paralysis and i'm choosing to read it as loyalty.",
    ]},
  },

  // --- new 52-week low ------------------------------------------------------
  despondent: {
    buy: { mood: "delighted", lines: [
      "buying me at a 52-week low. you absolute lunatic. i could kiss you.",
      "at the actual bottom of my year. you bought. i'm going to be normal about this. i'm not.",
    ]},
    sell: { mood: "resigned", lines: [
      "selling the 52-week low. the exact bottom. classic. no notes.",
      "out at the low. i'd say you'll regret it but honestly neither of us knows.",
    ]},
    hold: { mood: "wry", lines: [
      "you didn't sell at the low. that's either faith or you forgot i existed.",
      "held at a 52-week low. brave. or asleep. i'll take either.",
    ]},
  },

  // --- volume spike ---------------------------------------------------------
  attention: {
    buy: { mood: "wry", lines: [
      "buying into the noise. brave. everyone's watching, you know.",
      "you bought while the whole internet was looking at me. hope you like an audience.",
    ]},
    sell: { mood: "wry", lines: [
      "selling into the volume. someone out there is very happy to take your shares.",
      "out while it's loud. good exit, actually. annoyingly good.",
    ]},
    hold: { mood: "approving", lines: [
      "held through the chatter. probably right. volume isn't direction.",
      "ignored the noise entirely. genuinely the correct read.",
    ]},
  },

  // --- mundane check-in -----------------------------------------------------
  casual: {
    buy: { mood: "approving", lines: [
      "buying on a nothing day. no drama, no hype. respect the consistency.",
      "bought on a quiet one. that's how it's supposed to work, apparently.",
    ]},
    sell: { mood: "wry", lines: [
      "selling on a slow day. no panic, no reason. just vibes.",
      "sold on a day nothing happened. bold strategy. genuinely can't argue.",
    ]},
    hold: { mood: "wry", lines: [
      "held. nothing happened. good talk.",
      "no action on a no-news day. flawless. see you tomorrow.",
    ]},
  },
};

/**
 * Build the asset's comeback.
 *
 * `tone` is the mood of the message being answered. When a trade has no linked
 * message (placed from a quiet day with nothing on screen), it falls back to
 * the casual row rather than staying silent -- a reply with no response reads
 * like the app broke.
 */
export function reactionFor(opts: {
  ticker: string;
  date: string;
  tone: Tone | null | undefined;
  action: TradeAction;
  streak?: number;
  pctChange?: number;
}): Reaction {
  const tone: Tone = opts.tone ?? "casual";
  const variant = MATRIX[tone]?.[opts.action] ?? MATRIX.casual[opts.action];

  const idx = stableHash(`${opts.ticker}|${opts.date}|${tone}|${opts.action}`) % variant.lines.length;

  const text = variant.lines[idx]
    .replace(/\{n\}/g, String(opts.streak ?? 3))
    .replace(/\{pct\}/g, Math.abs(opts.pctChange ?? 0).toFixed(1))
    .replace(/\{ticker\}/g, opts.ticker);

  return { text, mood: variant.mood };
}
