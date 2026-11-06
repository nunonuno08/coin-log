// Turns the saved coin readings into "how much was earned" per record and per day.
//
// Earned between two readings = (coins now − coins before) + coins spent on gacha in between.
// Item costs (+Coin, 5→4 …) are already taken out of the coins in the game, so this is the
// real earning. The earning goes to the day of the later reading; when days without any
// reading lie in between, it is shared evenly between them and that day (those days are
// marked as estimated).
import { state, GACHA } from './store.js';
import { ymd, addDays, parseYmd } from './util.js';

/** Calendar day a moment belongs to, honouring the "day changes at" setting. */
export const dayOf = ms => ymd(new Date(ms - state.settings.dayStart * 3600000));
export const todayKey = () => dayOf(Date.now());
export const monthOf = day => day.slice(0, 7);

export function spentOf(r) {
  return GACHA.reduce((s, g) => s + (r.gacha?.[g.key] || 0) * (r.prices?.[g.key] ?? state.settings.prices[g.key]), 0);
}
export const drawsOf = r => GACHA.reduce((s, g) => s + (r.gacha?.[g.key] || 0), 0);

/**
 * days: Map 'YYYY-MM-DD' → { key, earned, spent, draws, records[], estimated }
 * gains: Map record id → { gain, spent, spread } (gain null for the very first reading)
 */
export function analyze() {
  const days = new Map();
  const gains = new Map();
  const day = k => {
    if (!days.has(k)) days.set(k, { key: k, earned: 0, spent: 0, draws: 0, records: [], estimated: false });
    return days.get(k);
  };
  state.records.forEach((r, i) => {
    const k = dayOf(r.at);
    const d = day(k);
    d.records.push(r);
    if (i === 0) {
      gains.set(r.id, { gain: null, spent: 0, spread: 1 });
      return;
    }
    const prev = state.records[i - 1];
    const spent = spentOf(r);
    const gain = r.coins - prev.coins + spent;
    d.spent += spent;
    d.draws += drawsOf(r);
    const missing = [];
    for (let x = addDays(dayOf(prev.at), 1); x < k; x = addDays(x, 1)) missing.push(x);
    const share = Math.trunc(gain / (missing.length + 1));
    for (const x of missing) {
      const e = day(x);
      e.earned += share;
      e.estimated = true;
    }
    d.earned += gain - share * missing.length;
    gains.set(r.id, { gain, spent, spread: missing.length + 1 });
  });
  return { days, gains };
}

/** Days in a row with at least one reading, counting back from today (or yesterday). */
export function streak(days) {
  let k = todayKey();
  if (!days.get(k)?.records.length) k = addDays(k, -1);
  let n = 0;
  while (days.get(k)?.records.length) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export function monthTotal(days, month) {
  let earned = 0;
  let draws = 0;
  for (const d of days.values()) {
    if (monthOf(d.key) !== month) continue;
    earned += d.earned;
    draws += d.draws;
  }
  return { earned, draws };
}

/** Goal for a month: its own, or the latest one set for an earlier month. */
export function monthGoal(month) {
  const goals = state.settings.monthlyGoals;
  const key = Object.keys(goals)
    .filter(m => m <= month && goals[m] > 0)
    .sort()
    .pop();
  return key ? goals[key] : 0;
}

/**
 * Weeks run Monday to Sunday, like the game's weekly ranking (it resets on Monday 0:00).
 * A week is named by its Monday, 'YYYY-MM-DD'.
 */
export function weekOf(day) {
  const back = (parseYmd(day).getDay() + 6) % 7; // days since Monday
  return addDays(day, -back);
}

export function weekTotal(days, week) {
  let earned = 0;
  let draws = 0;
  for (let i = 0; i < 7; i++) {
    const d = days.get(addDays(week, i));
    if (!d) continue;
    earned += d.earned;
    draws += d.draws;
  }
  return { earned, draws };
}

/** Goal for a week: its own, or the latest one set for an earlier week. */
export function weekGoal(week) {
  const goals = state.settings.weeklyGoals;
  const key = Object.keys(goals)
    .filter(w => w <= week && goals[w] > 0)
    .sort()
    .pop();
  return key ? goals[key] : 0;
}

export function bestDay(days) {
  let best = null;
  for (const d of days.values()) if (!d.estimated && d.records.length && (!best || d.earned > best.earned)) best = d;
  return best;
}

/** How many premium BOXes the amount would buy, e.g. 4.5 */
export const boxes = n => Math.floor((n / (state.settings.prices.premium || 30000)) * 10) / 10;
