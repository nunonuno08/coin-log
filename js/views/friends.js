// なかま: everyone's coins, today's and this week's earnings side by side, who is ahead, and
// past weeks' wins. Logged out, it shows the login / sign-up form.
import { todayKey, weekOf } from '../calc.js';
import { status, cloudReady, friends, refreshFriends, signIn, signUp } from '../cloud.js';
import { saveSettings } from '../store.js';
import { esc, num, short, toast, parseYmd, addDays } from '../util.js';
import { nav } from '../nav.js';

const md = k => {
  const d = parseYmd(k);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export function ago(ms) {
  if (!ms) return '記録なし';
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  if (min < 1440) return `${Math.floor(min / 60)}時間前`;
  return `${Math.floor(min / 1440)}日前`;
}

/** Colour per person, fixed by user name (same on both phones). */
const COLORS = ['#ffcf5a', '#ff8fb8', '#7ad7ff', '#9be38a', '#c9a2ff', '#ffa86b'];
export function colorOf(username) {
  let h = 0;
  for (const c of String(username)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** A race: one bar per person, longest = leader, and how far behind the others are. */
function race(title, people, value, unit) {
  const rows = people.map(p => ({ p, v: value(p) })).sort((a, b) => b.v - a.v);
  const max = Math.max(...rows.map(r => r.v), 1);
  const top = rows[0];
  const tie = rows.length > 1 && rows[1].v === top.v;
  const lead =
    rows.length < 2
      ? ''
      : top.v <= 0 && rows[1].v <= 0
        ? `<p class="race-note muted small">まだどちらも0枚。先に稼いだほうがリード！</p>`
        : tie
          ? `<p class="race-note small">ただいま<b>同点</b>！</p>`
          : `<p class="race-note small"><b style="color:${colorOf(top.p.username)}">${esc(top.p.name)}</b> がリード。${rows
              .slice(1)
              .map(r => `${esc(r.p.name)} はあと <b>${num(top.v - r.v + 1)}</b>枚で逆転`)
              .join('、')}</p>`;
  return `<section class="card race">
    <h2>${title}<span class="muted small">${unit}</span></h2>
    ${rows
      .map(
        ({ p, v }, i) => `<div class="race-row">
        <span class="race-name">${i === 0 && !tie && v > 0 ? '👑' : ''}${esc(p.name)}${p.me ? '<small>（自分）</small>' : ''}</span>
        <div class="race-track"><i style="width:${Math.max(0, (v / max) * 100)}%;background:${colorOf(p.username)}"></i></div>
        <b class="race-v">${short(v)}</b></div>`,
      )
      .join('')}
    ${lead}
  </section>`;
}

/** Finished weeks both took part in: who earned more. */
function history(people, thisWeek) {
  if (people.length < 2) return '';
  const weeks = [...new Set(people.flatMap(p => Object.keys(p.weeks || {})))].filter(w => w < thisWeek).sort().reverse();
  const results = weeks
    .map(w => {
      const vals = people.map(p => ({ p, v: p.weeks?.[w] })).filter(x => x.v != null);
      if (vals.length < 2) return null;
      vals.sort((a, b) => b.v - a.v);
      return { w, vals, winner: vals[0].v > vals[1].v ? vals[0].p : null };
    })
    .filter(Boolean);
  if (!results.length) return `<section class="card"><h2>週の勝敗</h2><p class="muted small">週が終わると、ここに勝ち負けがたまっていきます（月曜はじまり）。</p></section>`;
  const wins = new Map(people.map(p => [p.username, 0]));
  for (const r of results) if (r.winner) wins.set(r.winner.username, wins.get(r.winner.username) + 1);
  return `<section class="card">
    <h2>週の勝敗</h2>
    <div class="wins">${people.map(p => `<span><b style="color:${colorOf(p.username)}">${wins.get(p.username)}</b><small>${esc(p.name)}</small></span>`).join('<i>−</i>')}</div>
    <div class="wk-hist">${results
      .slice(0, 8)
      .map(
        r => `<div class="wk-h-row"><span class="muted small">${md(r.w)}〜${md(addDays(r.w, 6))}</span>
        <span>${r.winner ? `👑 <b style="color:${colorOf(r.winner.username)}">${esc(r.winner.name)}</b>` : '引き分け'}</span>
        <span class="muted small">${r.vals.map(x => short(x.v)).join(' 対 ')}</span></div>`,
      )
      .join('')}</div>
  </section>`;
}

function personCard(p, today, week) {
  return `<div class="card person" style="--c:${colorOf(p.username)}">
    <div class="person-head"><b>${esc(p.name)}</b>${p.me ? '<small class="muted">自分</small>' : ''}<span class="muted small">${ago(p.last_at)}</span></div>
    <div class="person-stats">
      <span><small>所持コイン</small><b class="coin-num">${p.coins != null ? num(p.coins) : '−'}</b></span>
      <span><small>今日</small><b class="coin-num">${short(p.days?.[today] || 0)}</b></span>
      <span><small>今週</small><b class="coin-num">${short(p.weeks?.[week] || 0)}</b></span>
      <span><small>連続</small><b class="coin-num">${p.streak || 0}日</b></span>
    </div>
    ${p.me && p.hidden ? '<p class="muted small">※ 今は相手に見せない設定です（設定で変えられます）</p>' : ''}
  </div>`;
}

function loginForm(view) {
  view.innerHTML = `
    <header class="top"><h1>なかま</h1></header>
    <section class="card login">
      <p class="small">ログインすると、なかまと<b>所持コイン・今日と今週の稼ぎ</b>を見せ合えます。<br>
      記録はクラウドにも保存され、機種変更しても消えません。</p>
      <div class="seg"><button type="button" class="on" data-mode="in">ログイン</button><button type="button" data-mode="up">はじめて登録</button></div>
      <label class="field"><span>ユーザー名（半角英数字）</span><input data-user autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="例: dan"></label>
      <label class="field"><span>パスワード（6文字以上）</span><input data-pass type="password" autocomplete="current-password"></label>
      <label class="field" data-name-field hidden><span>なかまに見せる名前（日本語OK）</span><input data-name placeholder="例: だん"></label>
      <button type="button" class="primary block" data-go>ログイン</button>
      <p class="muted small">パスワードを忘れると戻せません。控えておいてください。<br>登録できるのは、招待されたユーザー名だけです。</p>
    </section>`;
  let mode = 'in';
  const go = view.querySelector('[data-go]');
  view.querySelectorAll('[data-mode]').forEach(b =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      view.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
      view.querySelector('[data-name-field]').hidden = mode !== 'up';
      view.querySelector('[data-pass]').autocomplete = mode === 'up' ? 'new-password' : 'current-password';
      go.textContent = mode === 'up' ? '登録する' : 'ログイン';
    }),
  );
  go.addEventListener('click', async () => {
    const user = view.querySelector('[data-user]').value;
    const pass = view.querySelector('[data-pass]').value;
    const name = view.querySelector('[data-name]').value.trim();
    go.disabled = true;
    go.textContent = mode === 'up' ? '登録中…' : 'ログイン中…';
    try {
      if (mode === 'up') {
        await signUp(user, pass);
        if (name) await saveSettings({ name });
      } else await signIn(user, pass);
      toast(mode === 'up' ? '登録しました' : 'ログインしました');
      nav.rerender();
    } catch (err) {
      toast(err.message, 5000);
      go.disabled = false;
      go.textContent = mode === 'up' ? '登録する' : 'ログイン';
    }
  });
}

let refreshedAt = 0;

export function render(view) {
  if (!cloudReady()) {
    view.innerHTML = `<header class="top"><h1>なかま</h1></header><p class="empty">ただいま準備中です。<br>もうしばらくお待ちください。</p>`;
    return;
  }
  if (status.state === 'signedOut') return loginForm(view);

  const today = todayKey();
  const week = weekOf(today);
  const people = friends();
  const others = people.filter(p => !p.me);

  view.innerHTML = `
    <header class="top"><h1>なかま</h1><button type="button" class="txt small" data-refresh>${status.state === 'syncing' ? '更新中…' : '更新'}</button></header>
    ${status.state === 'error' ? `<p class="banner warn">${esc(status.error)}</p>` : ''}
    ${
      others.length
        ? race('今日の勝負', people, p => p.days?.[today] || 0, '') + race('今週の勝負', people, p => p.weeks?.[week] || 0, `${md(week)}〜${md(addDays(week, 6))}`)
        : `<section class="card"><p class="small">まだ、なかまが見つかりません。相手がログインして記録すると、ここに並びます。</p></section>`
    }
    <div class="people">${people.map(p => personCard(p, today, week)).join('')}</div>
    ${history(people, week)}
    <p class="muted small center">ほかの人の数字は、その人が最後にアプリを開いて同期したときのものです。</p>`;

  view.querySelector('[data-refresh]').addEventListener('click', () => refreshFriends());
  // Fresh numbers when the screen opens (not again on every redraw).
  if (Date.now() - refreshedAt > 30000) {
    refreshedAt = Date.now();
    refreshFriends();
  }
}

