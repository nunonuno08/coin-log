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
  weeklyGoals: {}, // { '2026-11-02' (Monday): 1000000 } — same fallback as months
  monthlyGoals: {}, // { '2026-11': 4500000 } — a month without one uses the latest earlier one
  prices: { premium: 30000, select: 30000, pickup: 30000 },
  dayStart: 0, // hour the day changes (late-night play can still count for the evening before)
  frames: {}, // where the user framed the coin count, per screen shape: { '0.460': { x, y, w, h } } (0..1)
  name: '', // name shown to friends (なかま)
  share: true, // show my totals to friends
  updatedAt: 0, // last change (the newer settings win when syncing)
};

/** Fires 'change' whenever something is saved or deleted (the cloud sync listens). */
export const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event('change'));

/* ---------- deletions waiting to be sent to the cloud ---------- */

const TOMBS_KEY = 'coinlog-tombs';
export function readTombs() {
  try {
    return JSON.parse(localStorage.getItem(TOMBS_KEY)) || [];
  } catch {
    return [];
  }
}
export function writeTombs(list) {
  try {
    localStorage.setItem(TOMBS_KEY, JSON.stringify(list));
  } catch {}
}
/** Whether deletions should be remembered for the cloud (set by cloud.js while logged in). */
export const sync = { on: false };
function tomb(id, at) {
  if (sync.on) writeTombs([...readTombs(), { kind: 'records', id, at }]);
}

/**
 * records: [{ id, at (ms), coins, gacha: { premium, select, pickup } drawn since the record
 * before, prices: the price of each kind at the time, source: 'ocr' | 'manual', createdAt, updatedAt }]
 * kept sorted by `at`.
 */
export const state = { records: [], settings: structuredClone(DEFAULTS) };

const byAt = (a, b) => a.at - b.at || a.createdAt - b.createdAt;

function withDefaults(s = {}) {
  const out = {
    ...structuredClone(DEFAULTS),
    ...s,
    prices: { ...DEFAULTS.prices, ...(s.prices || {}) },
    monthlyGoals: { ...(s.monthlyGoals || {}) },
    weeklyGoals: { ...(s.weeklyGoals || {}) },
    frames: { ...(s.frames || {}) },
  };
  // Up to v0.2.0 one frame (`crop`) was used for every phone — the cause of the misreads
  // across devices. Its screen shape is unknown, so it is dropped; the presets take over.
  delete out.crop;
  return out;
}

export async function load() {
  state.records = (await db.getAll('records')).sort(byAt);
  state.settings = withDefaults((await db.get('kv', 'settings'))?.value);
}

export async function saveSettings(patch) {
  Object.assign(state.settings, patch, { updatedAt: Date.now() });
  await db.put('kv', { id: 'settings', value: state.settings });
  changed();
}

export async function saveRecord(r) {
  const now = Date.now();
  r.createdAt ??= now;
  r.updatedAt = now;
  await db.put('records', r);
  state.records = [...state.records.filter(x => x.id !== r.id), r].sort(byAt);
  changed();
}

export async function deleteRecord(id) {
  const old = state.records.find(r => r.id === id);
  await db.del('records', id);
  state.records = state.records.filter(r => r.id !== id);
  // Always later than the record's last change, so the deletion wins on other devices.
  tomb(id, Math.max(Date.now(), (old?.updatedAt || 0) + 1));
  changed();
}

/* ---------- changes arriving from the cloud (no 'change' event: they are not new here) ---------- */

export async function applyRemote(kind, data) {
  if (kind === 'settings') {
    state.settings = withDefaults(data);
    await db.put('kv', { id: 'settings', value: state.settings });
  } else {
    await db.put('records', data);
    state.records = [...state.records.filter(x => x.id !== data.id), data].sort(byAt);
  }
}

export async function removeRemote(kind, id) {
  if (kind !== 'records') return;
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
  const now = Date.now();
  // Restored = changed now, so the backup wins over the cloud copy too.
  const records = data.records.filter(r => r && r.id && Number.isFinite(r.at) && Number.isFinite(r.coins)).map(r => ({ ...r, updatedAt: now }));
  const keep = new Set(records.map(r => r.id));
  for (const r of state.records) if (!keep.has(r.id)) tomb(r.id, Math.max(now, (r.updatedAt || 0) + 1));
  await db.clear('records', 'kv');
  if (records.length) await db.put('records', ...records);
  await db.put('kv', { id: 'settings', value: { ...withDefaults(data.settings), updatedAt: now } });
  await load();
  changed();
  return records.length;
}

/** Deletes every record (and, while logged in, the cloud copies too). Settings start over. */
export async function deleteAll() {
  const now = Date.now();
  for (const r of state.records) tomb(r.id, Math.max(now, (r.updatedAt || 0) + 1));
  const { name, share } = state.settings;
  await db.clear('records', 'kv');
  await load();
  // Keep who this is for friends; everything else back to the start.
  if (sync.on) await saveSettings({ name, share });
  changed();
}
