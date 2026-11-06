// In-memory copy of everything saved on this phone, and the functions that change it.
import * as db from './db.js';

/** Gacha kinds that cost coins (ハピネスBOX is left out on purpose — the user rarely draws it). */
export const GACHA = [
  { key: 'premium', name: 'プレミアムBOX' },
  { key: 'select', name: 'セレクトBOX' },
  { key: 'pickup', name: 'ピックアップガチャ' },
];

const DEFAULTS = {
  dailyGoal: 0, // the same goal for every day
  monthlyGoals: {}, // { '2026-11': 4500000 } — a month without one uses the latest earlier one
  prices: { premium: 30000, select: 30000, pickup: 30000 },
  dayStart: 0, // hour the day changes (late-night play can still count for the evening before)
  crop: null, // where the coin count is in a screenshot, as 0..1 of the image
};

/**
 * records: [{ id, at (ms), coins, gacha: { premium, select, pickup } drawn since the record
 * before, prices: the price of each kind at the time, source: 'ocr' | 'manual', createdAt, updatedAt }]
 * kept sorted by `at`.
 */
export const state = { records: [], settings: structuredClone(DEFAULTS) };

const byAt = (a, b) => a.at - b.at || a.createdAt - b.createdAt;

function withDefaults(s = {}) {
  return { ...structuredClone(DEFAULTS), ...s, prices: { ...DEFAULTS.prices, ...(s.prices || {}) }, monthlyGoals: { ...(s.monthlyGoals || {}) } };
}

export async function load() {
  state.records = (await db.getAll('records')).sort(byAt);
  state.settings = withDefaults((await db.get('kv', 'settings'))?.value);
}

export async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await db.put('kv', { id: 'settings', value: state.settings });
}

export async function saveRecord(r) {
  const now = Date.now();
  r.createdAt ??= now;
  r.updatedAt = now;
  await db.put('records', r);
  state.records = [...state.records.filter(x => x.id !== r.id), r].sort(byAt);
}

export async function deleteRecord(id) {
  await db.del('records', id);
  state.records = state.records.filter(r => r.id !== id);
}

/** The record just before `at` (skipping `exceptId`), the base for counting what was earned. */
export function recordBefore(at, exceptId) {
  let prev = null;
  for (const r of state.records) {
    if (r.id === exceptId) continue;
    if (r.at < at || (r.at === at && !exceptId)) prev = r;
    else break;
  }
  return prev;
}

export const latestRecord = () => state.records[state.records.length - 1] || null;

/* ---------- backup ---------- */

export function backupData() {
  return { app: 'coinlog', savedAt: new Date().toISOString(), records: state.records, settings: state.settings };
}

export async function restoreData(data) {
  if (data?.app !== 'coinlog' || !Array.isArray(data.records)) throw new Error('このアプリのバックアップファイルではありません');
  const records = data.records.filter(r => r && r.id && Number.isFinite(r.at) && Number.isFinite(r.coins));
  await db.clear('records', 'kv');
  if (records.length) await db.put('records', ...records);
  await db.put('kv', { id: 'settings', value: withDefaults(data.settings) });
  await load();
  return records.length;
}

export async function deleteAll() {
  await db.clear('records', 'kv');
  await load();
}
