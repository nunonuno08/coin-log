// Settings: goals, gacha prices, when the day changes, screenshot frame, backup.
import { state, GACHA, saveSettings, backupData, restoreData, deleteAll } from '../store.js';
import { todayKey, monthOf } from '../calc.js';
import { num, digits, toast, ymd } from '../util.js';
import { nav } from '../nav.js';

export const VERSION = 'v0.1.1';

export function render(view) {
  const s = state.settings;
  const month = monthOf(todayKey());
  const [, mm] = month.split('-').map(Number);

  view.innerHTML = `
    <header class="top"><h1>設定</h1></header>

    <h3 class="sec">目標</h3>
    <div class="card set">
      <label class="set-row"><span>1日の目標<small>毎日同じ目標になります</small></span>
        <span class="num-in"><input type="text" inputmode="numeric" data-goal="daily" value="${s.dailyGoal ? num(s.dailyGoal) : ''}" placeholder="未設定"><i>枚</i></span></label>
      <label class="set-row"><span>${mm}月の目標<small>決めない月は前の月の目標を使います</small></span>
        <span class="num-in"><input type="text" inputmode="numeric" data-goal="month" value="${s.monthlyGoals[month] ? num(s.monthlyGoals[month]) : ''}" placeholder="未設定"><i>枚</i></span></label>
      <button type="button" class="txt small" data-fill>1日の目標 × 日数 で月の目標を入れる</button>
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
      <div class="set-row"><span>スクショの読み取り位置<small>${s.crop ? '自分で選んだ場所' : '自動（ツムツムのいつもの場所）'}</small></span>
        <button type="button" class="small" data-crop ${s.crop ? '' : 'disabled'}>自動に戻す</button></div>
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

  view.querySelector('[data-goal="daily"]').addEventListener('change', e => {
    pretty(e.target);
    save({ dailyGoal: val(e.target) });
  });
  view.querySelector('[data-goal="month"]').addEventListener('change', e => {
    pretty(e.target);
    save({ monthlyGoals: { ...s.monthlyGoals, [month]: val(e.target) } });
  });
  view.querySelector('[data-fill]').addEventListener('click', () => {
    if (!s.dailyGoal) return toast('先に1日の目標を入れてください');
    const [y, m] = month.split('-').map(Number);
    const goal = s.dailyGoal * new Date(y, m, 0).getDate();
    view.querySelector('[data-goal="month"]').value = num(goal);
    save({ monthlyGoals: { ...s.monthlyGoals, [month]: goal } });
  });
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
    await save({ crop: null }, '自動の場所に戻しました');
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
    if (!confirm('すべての記録と設定を削除します。元に戻せません。よろしいですか？')) return;
    await deleteAll();
    toast('削除しました');
    nav.rerender();
  });
}
