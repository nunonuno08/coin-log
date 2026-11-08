// Settings: account (cloud), goals, gacha prices, when the day changes, screenshot frame, backup.
import { state, GACHA, saveSettings, backupData, restoreData, deleteAll } from '../store.js';
import { todayKey, monthOf, monthGoal, weekOf, weekGoal } from '../calc.js';
import { num, digits, toast, ymd, addDays, parseYmd, esc } from '../util.js';
import { cloudReady, status, pendingCount, syncNow, signOut } from '../cloud.js';
import { ago } from './friends.js';
import { nav } from '../nav.js';

export const VERSION = 'v0.4.0';

const md = k => {
  const d = parseYmd(k);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const SYNC_LABEL = { idle: '同期済み', syncing: '同期中…', offline: 'オフライン（つながったら同期します）', error: '同期できませんでした' };

/** Account / sync / what friends see. Empty until the cloud is set up. */
function accountHtml(s) {
  if (!cloudReady()) return '';
  if (status.state === 'signedOut') {
    return `<h3 class="sec">アカウント</h3>
    <div class="card set"><p class="small">ログインしていません。記録はこの iPhone の中だけにあります。</p>
      <a class="btn block center" href="#/friends">ログイン・登録する</a></div>`;
  }
  const n = pendingCount();
  return `<h3 class="sec">アカウント</h3>
    <div class="card set">
      <div class="set-row"><span>${esc(status.username)}<small>${SYNC_LABEL[status.state] || ''}${status.lastSync ? `・最終 ${ago(status.lastSync)}` : ''}${n ? `・未送信 ${n}件` : ''}</small></span>
        <button type="button" class="small" data-sync>今すぐ同期</button></div>
      ${status.state === 'error' ? `<p class="small neg">${esc(status.error)}</p>` : ''}
      <label class="set-row"><span>なかまに見せる名前</span><input class="name-in" data-name value="${esc(s.name)}" placeholder="${esc(status.username)}"></label>
      <label class="set-row"><span>なかまに数字を見せる<small>所持コイン・今日・今週・連続記録だけ</small></span>
        <input type="checkbox" class="switch" data-share ${s.share ? 'checked' : ''}></label>
      <button type="button" class="txt small" data-logout>ログアウト</button>
    </div>`;
}

export function render(view) {
  const s = state.settings;
  const month = monthOf(todayKey());
  const week = weekOf(todayKey());
  const [, mm] = month.split('-').map(Number);

  view.innerHTML = `
    <header class="top"><h1>設定</h1></header>
    ${accountHtml(s)}

    <h3 class="sec">目標</h3>
    <div class="card set">
      <label class="set-row"><span>1日の目標<small>毎日同じ目標になります</small></span>
        <span class="num-in"><input type="text" inputmode="numeric" data-goal="daily" value="${s.dailyGoal ? num(s.dailyGoal) : ''}" placeholder="未設定"><i>枚</i></span></label>
      <label class="set-row"><span>今週の目標<small>${md(week)}〜${md(addDays(week, 6))}。決めない週は前の週の目標</small></span>
        <span class="num-in"><input type="text" inputmode="numeric" data-goal="week" value="${s.weeklyGoals[week] ? num(s.weeklyGoals[week]) : ''}" placeholder="${weekGoal(week) ? num(weekGoal(week)) : '未設定'}"><i>枚</i></span></label>
      <label class="set-row"><span>${mm}月の目標<small>決めない月は前の月の目標を使います</small></span>
        <span class="num-in"><input type="text" inputmode="numeric" data-goal="month" value="${s.monthlyGoals[month] ? num(s.monthlyGoals[month]) : ''}" placeholder="${monthGoal(month) ? num(monthGoal(month)) : '未設定'}"><i>枚</i></span></label>
      <div class="btn-row fill-row"><button type="button" class="small" data-fill="week">1日 × 7日 を週に</button><button type="button" class="small" data-fill="month">1日 × 日数 を月に</button></div>
    </div>

    <h3 class="sec">ガチャの値段</h3>
    <div class="card set">
      ${GACHA.map(
        g => `<label class="set-row"><span>${g.name}</span>
        <span class="num-in"><input type="text" inputmode="numeric" data-price="${g.key}" value="${num(s.prices[g.key])}"><i>枚</i></span></label>`,
      ).join('')}
      <p class="muted small">変えても、これまでの記録は記録したときの値段のままです。</p>
    </div>

    <h3 class="sec">記録</h3>
    <div class="card set">
      <label class="set-row"><span>日付の切り替え<small>夜中のプレイを前の日に入れたいときに</small></span>
        <select data-daystart>${[0, 1, 2, 3, 4, 5, 6].map(h => `<option value="${h}" ${s.dayStart === h ? 'selected' : ''}>${h}:00</option>`).join('')}</select></label>
      <div class="set-row"><span>スクショの読み取り位置<small>iPhone・iPad は登録済み${Object.keys(s.frames).length ? `／自分で選んだ機種 ${Object.keys(s.frames).length}種類` : ''}</small></span>
        <button type="button" class="small" data-crop ${Object.keys(s.frames).length ? '' : 'disabled'}>自動に戻す</button></div>
    </div>

    <h3 class="sec">記録忘れの防止</h3>
    <div class="card set">
      <p class="small">今はアプリから通知を出せないため、iPhone の<b>「リマインダー」</b>アプリで<br>
      「コインを記録」→ 日付と時刻 → <b>繰り返し: 毎日</b> と設定するのがおすすめです。</p>
      <p class="muted small">記録を忘れた日があっても、次に記録したときに日数で分けて計算されます。</p>
    </div>

    <h3 class="sec">バックアップ</h3>
    <div class="card set">
      <div class="btn-row"><button type="button" data-backup>保存する</button><button type="button" data-restore>復元する</button></div>
      <p class="muted small">記録はこの iPhone の中だけにあります。ときどき保存して「ファイル」アプリなどに置いておくと安心です。</p>
    </div>

    <h3 class="sec">データ</h3>
    <div class="card set"><button type="button" class="danger block" data-wipe>すべての記録を削除</button></div>

    <p class="muted small center version">コイン記録 ${VERSION}</p>`;

  const save = async (patch, msg = '保存しました') => {
    await saveSettings(patch);
    toast(msg);
  };
  const val = input => (digits(input.value) ? Number(digits(input.value)) : 0);
  const pretty = input => (input.value = val(input) ? num(val(input)) : '');

  view.querySelector('[data-sync]')?.addEventListener('click', () => syncNow());
  view.querySelector('[data-name]')?.addEventListener('change', e => save({ name: e.target.value.trim() }));
  view.querySelector('[data-share]')?.addEventListener('change', e => save({ share: e.target.checked }, e.target.checked ? 'なかまに見せます' : 'なかまに見せないようにしました'));
  view.querySelector('[data-logout]')?.addEventListener('click', async () => {
    const n = pendingCount();
    const msg = n
      ? `まだクラウドに送っていない変更が ${n}件 あります。ログアウトすると、ほかの端末には届きません。ログアウトしますか？`
      : 'ログアウトしますか？（この iPhone の記録は残ります）';
    if (!confirm(msg)) return;
    await signOut();
    toast('ログアウトしました');
    nav.rerender();
  });

  view.querySelector('[data-goal="daily"]').addEventListener('change', e => {
    pretty(e.target);
    save({ dailyGoal: val(e.target) });
  });
  view.querySelector('[data-goal="month"]').addEventListener('change', e => {
    pretty(e.target);
    save({ monthlyGoals: { ...s.monthlyGoals, [month]: val(e.target) } });
  });
  view.querySelector('[data-goal="week"]').addEventListener('change', e => {
    pretty(e.target);
    save({ weeklyGoals: { ...s.weeklyGoals, [week]: val(e.target) } });
  });
  view.querySelectorAll('[data-fill]').forEach(b =>
    b.addEventListener('click', () => {
      if (!s.dailyGoal) return toast('先に1日の目標を入れてください');
      if (b.dataset.fill === 'week') {
        const goal = s.dailyGoal * 7;
        view.querySelector('[data-goal="week"]').value = num(goal);
        return save({ weeklyGoals: { ...s.weeklyGoals, [week]: goal } });
      }
      const [y, m] = month.split('-').map(Number);
      const goal = s.dailyGoal * new Date(y, m, 0).getDate();
      view.querySelector('[data-goal="month"]').value = num(goal);
      save({ monthlyGoals: { ...s.monthlyGoals, [month]: goal } });
    }),
  );
  view.querySelectorAll('[data-price]').forEach(input =>
    input.addEventListener('change', () => {
      const v = val(input);
      if (!v) {
        input.value = num(s.prices[input.dataset.price]);
        return toast('値段を入れてください');
      }
      pretty(input);
      save({ prices: { ...s.prices, [input.dataset.price]: v } });
    }),
  );
  view.querySelector('[data-daystart]').addEventListener('change', e => save({ dayStart: Number(e.target.value) }));
  view.querySelector('[data-crop]').addEventListener('click', async () => {
    await save({ frames: {} }, '自動の場所に戻しました');
    nav.rerender();
  });

  view.querySelector('[data-backup]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(backupData(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coin-backup-${ymd(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
  view.querySelector('[data-restore]').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!confirm('今の記録を、バックアップの内容に置き換えます。よろしいですか？')) return;
        const n = await restoreData(data);
        toast(`${n}件の記録を復元しました`);
        nav.rerender();
      } catch (err) {
        toast(err instanceof SyntaxError ? 'ファイルを読めませんでした' : err.message);
      }
    });
    input.click();
  });
  view.querySelector('[data-wipe]').addEventListener('click', async () => {
    if (!confirm(`すべての記録と設定を削除します。${status.state !== 'signedOut' ? 'ログイン中なので、クラウドとほかの端末からも消えます。' : ''}元に戻せません。よろしいですか？`)) return;
    await deleteAll();
    toast('削除しました');
    nav.rerender();
  });
}
