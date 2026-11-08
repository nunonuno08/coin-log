// Cloud (Supabase): login by user name, sync of one's own readings between devices, and the
// totals friends show each other (なかま). The phone stays the working copy and works offline;
// when online, changes go up, other devices' changes come down, and the newer change wins.
import { state, changes, readTombs, writeTombs, applyRemote, removeRemote, latestRecord, sync } from './store.js';
import { analyze, todayKey, weekOf, weekTotal, streak } from './calc.js';
import { addDays } from './util.js';

// Filled in once the Supabase project exists (both values are meant to be public: the
// database only lets each account change its own rows).
const SUPABASE_URL = '';
const SUPABASE_KEY = '';
export const cloudReady = () => !!(SUPABASE_URL && SUPABASE_KEY);

/** Supabase logs in by e-mail; the user name becomes this address (never shown, never mailed). */
const DOMAIN = 'nunonuno08.github.io';
const toEmail = username => `${username}@${DOMAIN}`;
const toName = email => String(email || '').split('@')[0];
/** Half-width letters, numbers and . _ - ; 2 to 20 characters. */
export const normalizeUsername = s => String(s || '').normalize('NFKC').trim().toLowerCase();
export const validUsername = s => /^[a-z0-9._-]{2,20}$/.test(s);

const AUTH_KEY = 'coinlog-auth';
const META_KEY = 'coinlog-sync';
const FRIENDS_KEY = 'coinlog-friends';
const PAGE = 1000;
const CHUNK = 300;

/* ---------- status ---------- */

export const status = { state: 'signedOut', username: '', userId: '', lastSync: 0, error: '' };
export const statusEvents = new EventTarget();
function setStatus(patch) {
  Object.assign(status, patch);
  sync.on = status.state !== 'signedOut';
  statusEvents.dispatchEvent(new Event('change'));
}

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

/* ---------- client ---------- */

let clientPromise;
function client() {
  if (!cloudReady()) return Promise.reject(new Error('クラウドの準備がまだです'));
  clientPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/supabase.js';
    s.onload = () =>
      resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true } }));
    s.onerror = () => {
      clientPromise = null;
      reject(new Error('同期機能を読み込めませんでした'));
    };
    document.head.append(s);
  });
  return clientPromise;
}

const hasSavedSession = () => {
  try {
    return !!localStorage.getItem(AUTH_KEY);
  } catch {
    return false;
  }
};

/** Changes made on this phone that the cloud doesn't have yet (edits and deletions). */
export function pendingCount() {
  const { lastPush = 0 } = readJson(META_KEY, {});
  let n = readTombs().length;
  for (const r of state.records) if ((r.updatedAt || 1) > lastPush) n++;
  if ((state.settings.updatedAt || 0) > lastPush) n++;
  return n;
}

/* ---------- account ---------- */

const MESSAGES = [
  [/invalid login credentials/i, 'ユーザー名かパスワードが違います'],
  [/already registered|already been registered|already exists/i, 'このユーザー名はすでに登録されています。「ログイン」してください'],
  [/password should be at least|weak password/i, 'パスワードは6文字以上にしてください'],
  [/signups not allowed|signup is disabled/i, '現在、新しい登録は受け付けていません'],
  // Sign-ups are limited to invited names (supabase/schema.sql); the refusal arrives as a
  // generic database error.
  [/not invited|database error saving new user/i, '招待されていないユーザー名です。招待してくれた人に、このユーザー名を伝えてください'],
  [/invalid email|unable to validate email|email address .* is invalid/i, 'このユーザー名は使えません（半角の英字と数字にしてください）'],
  [/rate limit/i, '短時間に何度も試したため、しばらく待ってからもう一度お試しください'],
  // Safari says "Load failed". Online but unreachable usually means the server is paused.
  [/failed to fetch|load failed|network/i, () => (navigator.onLine ? 'クラウドにつながりません（サーバーが止まっている可能性があります）' : 'ネットに接続できません')],
];
const friendly = err => {
  const msg = MESSAGES.find(([re]) => re.test(err?.message || ''))?.[1];
  return (typeof msg === 'function' ? msg() : msg) || err?.message || 'エラーが発生しました';
};

function checkName(username) {
  if (!validUsername(username)) throw new Error('ユーザー名は半角の英字と数字で、2〜20文字にしてください');
}

export async function signUp(username, password) {
  username = normalizeUsername(username);
  checkName(username);
  const sb = await client();
  const { data, error } = await sb.auth.signUp({ email: toEmail(username), password });
  if (error) throw new Error(friendly(error));
  if (!data.session) throw new Error('登録できましたが、ログインできませんでした。「ログイン」をお試しください');
  await afterLogin(data.session);
}

export async function signIn(username, password) {
  username = normalizeUsername(username);
  checkName(username);
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
  if (error) throw new Error(friendly(error));
  await afterLogin(data.session);
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
  writeJson(FRIENDS_KEY, []);
  setStatus({ state: 'signedOut', username: '', userId: '', error: '' });
}

async function afterLogin(session) {
  const meta = readJson(META_KEY, {});
  // Another account than last time: start over, so this phone's data is uploaded to it.
  if (meta.userId !== session.user.id) {
    writeJson(META_KEY, { userId: session.user.id, lastPush: 0, lastPull: '', lastSync: 0 });
    writeJson(FRIENDS_KEY, []);
  }
  setStatus({ state: 'idle', username: toName(session.user.email), userId: session.user.id, error: '' });
  await syncNow();
}

/* ---------- sync ---------- */

let running = null;
let again = false;
let changedDuringSync = false;

/** Runs a sync (or queues one right after the current run). */
export function syncNow() {
  if (running) {
    again = true;
    return running;
  }
  running = run()
    .catch(err => setStatus({ state: 'error', error: friendly(err) }))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        syncNow();
      }
    });
  return running;
}

async function run() {
  const sb = await client();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return setStatus({ state: 'signedOut', username: '', userId: '' });
  const username = toName(session.user.email);
  if (!navigator.onLine) return setStatus({ state: 'offline', username, userId: session.user.id });
  const uid = session.user.id;
  const meta = { lastPush: 0, lastPull: '', ...readJson(META_KEY, {}), userId: uid };
  changedDuringSync = false;
  setStatus({ state: 'syncing', username, userId: uid, error: '' });

  /* 1. upload changed and deleted records, and the settings if they changed */
  const rows = [];
  let pushedUpTo = meta.lastPush;
  for (const r of state.records) {
    const at = r.updatedAt || 1;
    if (at <= meta.lastPush) continue;
    rows.push({ user_id: uid, kind: 'records', id: r.id, data: r, deleted: false, updated_at: at });
    pushedUpTo = Math.max(pushedUpTo, at);
  }
  const sAt = state.settings.updatedAt || 0;
  if (sAt > meta.lastPush) {
    rows.push({ user_id: uid, kind: 'settings', id: 'settings', data: state.settings, deleted: false, updated_at: sAt });
    pushedUpTo = Math.max(pushedUpTo, sAt);
  }
  const tombs = readTombs();
  for (const t of tombs) rows.push({ user_id: uid, kind: t.kind, id: t.id, data: null, deleted: true, updated_at: t.at });
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb.from('records').upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,kind,id' });
    if (error) throw error;
  }
  // Only forget tombstones that were sent; deletions made meanwhile stay queued.
  const sent = new Set(tombs.map(t => `${t.kind}:${t.id}:${t.at}`));
  writeTombs(readTombs().filter(t => !sent.has(`${t.kind}:${t.id}:${t.at}`)));

  /* 2. download other devices' changes */
  let from = meta.lastPull || '1970-01-01T00:00:00Z';
  let pulledUpTo = 0;
  let received = 0;
  for (;;) {
    // gte + small overlap: rows saved together share one server time.
    const { data, error } = await sb.from('records').select('kind,id,data,deleted,updated_at,server_at').gte('server_at', from).order('server_at').limit(PAGE);
    if (error) throw error;
    for (const row of data) {
      const local = row.kind === 'settings' ? state.settings : state.records.find(r => r.id === row.id);
      const localAt = local?.updatedAt || 0;
      if (row.deleted) {
        if (local && row.kind === 'records' && localAt <= row.updated_at) {
          await removeRemote(row.kind, row.id);
          received++;
        }
      } else if (!local || localAt < row.updated_at) {
        await applyRemote(row.kind, row.data);
        received++;
      }
      pulledUpTo = Math.max(pulledUpTo, row.updated_at);
    }
    if (data.length) from = data.at(-1).server_at;
    if (data.length < PAGE) break;
  }

  // Records just downloaded don't need to be uploaded back, unless something changed meanwhile.
  meta.lastPush = changedDuringSync ? pushedUpTo : Math.max(pushedUpTo, pulledUpTo);
  meta.lastPull = from;
  meta.lastSync = Date.now();
  writeJson(META_KEY, meta);

  /* 3. my totals for friends, then theirs */
  await pushSummary(sb, uid, username);
  await pullFriends(sb);

  setStatus({ state: 'idle', lastSync: meta.lastSync, error: '' });
  if (received) statusEvents.dispatchEvent(new CustomEvent('received', { detail: received }));
}

/* ---------- なかま: totals friends see ---------- */

/** Totals only — days and weeks as { key: earned } — never the readings themselves. */
export function mySummary(username) {
  const { days } = analyze();
  const today = todayKey();
  const dayTotals = {};
  for (let i = 0; i < 14; i++) {
    const k = addDays(today, -i);
    if (days.has(k)) dayTotals[k] = days.get(k).earned;
  }
  const weekTotals = {};
  for (let i = 0, w = weekOf(today); i < 12; i++, w = addDays(w, -7)) {
    const t = weekTotal(days, w);
    if (t.earned || [...Array(7)].some((_, j) => days.has(addDays(w, j)))) weekTotals[w] = t.earned;
  }
  const last = latestRecord();
  return {
    username,
    name: state.settings.name || username,
    coins: last?.coins ?? null,
    last_at: last?.at ?? null,
    streak: streak(days),
    days: dayTotals,
    weeks: weekTotals,
  };
}

async function pushSummary(sb, uid, username) {
  if (!state.settings.share) {
    const { error } = await sb.from('summaries').delete().eq('user_id', uid);
    if (error) throw error;
    return;
  }
  const { error } = await sb.from('summaries').upsert({ user_id: uid, ...mySummary(username), updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function pullFriends(sb) {
  const { data, error } = await sb.from('summaries').select('*').order('username');
  if (error) throw error;
  writeJson(FRIENDS_KEY, data);
  statusEvents.dispatchEvent(new Event('friends'));
}

/** Everyone's totals as last fetched (works offline). Mine is replaced by the fresh local one. */
export function friends() {
  const list = readJson(FRIENDS_KEY, []).filter(f => f.user_id !== status.userId);
  if (status.userId) list.unshift({ user_id: status.userId, me: true, ...mySummary(status.username), hidden: !state.settings.share });
  return list;
}

/** Fetches friends' latest totals now (when the なかま screen opens). */
export async function refreshFriends() {
  if (status.state === 'signedOut' || !navigator.onLine) return;
  return syncNow();
}

/* ---------- start-up ---------- */

let timer;
const scheduleSync = () => {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), 4000);
};

/** Starts automatic syncing if this phone is logged in. Never loads the library otherwise. */
export function initCloud() {
  status.lastSync = readJson(META_KEY, {}).lastSync || 0;
  changes.addEventListener('change', () => {
    if (running) changedDuringSync = true;
    if (status.state !== 'signedOut') scheduleSync();
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && status.state !== 'signedOut' && syncNow());
  window.addEventListener('online', () => status.state !== 'signedOut' && syncNow());
  if (cloudReady() && hasSavedSession()) {
    const { userId } = readJson(META_KEY, {});
    setStatus({ state: 'idle', userId: userId || '' });
    syncNow();
  }
}
