// Calendar: one month, each day tinted by how much was earned; tap a day for its readings.
import { state } from '../store.js';
import { analyze, todayKey, monthOf, monthTotal, monthGoal, boxes } from '../calc.js';
import { editRecord } from '../record.js';
import { openSheet } from '../ui.js';
import { num, signed, short, pad, dayLabel, timeLabel, ymd } from '../util.js';

let shown = null; // 'YYYY-MM' being looked at (kept while switching tabs)

export function render(view) {
  const { days, gains } = analyze();
  const today = todayKey();
  shown ??= monthOf(today);
  const [y, m] = shown.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const count = new Date(y, m, 0).getDate();
  const keys = Array.from({ length: count }, (_, i) => `${shown}-${pad(i + 1)}`);
  const vals = keys.map(k => days.get(k)?.earned || 0);
  const max = Math.max(...vals, 1);
  const mt = monthTotal(days, shown);
  const goal = monthGoal(shown);
  const dailyGoal = state.settings.dailyGoal;
  const recorded = keys.filter(k => days.get(k)?.records.length);
  const best = keys.reduce((b, k) => (!days.get(k)?.estimated && days.get(k)?.records.length && (!b || days.get(k).earned > days.get(b).earned) ? k : b), null);
  const avg = recorded.length ? mt.earned / keys.filter(k => days.has(k) && k <= today).length : 0;

  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<span class="cal-cell blank"></span>');
  keys.forEach((k, i) => {
    const d = days.get(k);
    const v = vals[i];
    const a = v > 0 ? 0.12 + 0.88 * (v / max) : 0;
    const hit = dailyGoal && v >= dailyGoal;
    cells.push(`<button type="button" class="cal-cell ${k === today ? 'today' : ''} ${d?.estimated ? 'est' : ''} ${hit ? 'hit' : ''} ${k > today ? 'future' : ''} ${a >= 0.5 ? 'deep' : ''}"
      data-k="${k}" style="--a:${a.toFixed(2)}" ${d ? '' : 'disabled'}><span class="cal-d">${i + 1}</span><span class="cal-v">${v ? short(v) : ''}</span></button>`);
  });

  view.innerHTML = `
    <header class="top"><h1>カレンダー</h1></header>
    <div class="month-nav card">
      <button type="button" class="icon" data-mv="-1" aria-label="前の月">‹</button>
      <b>${y}年${m}月</b>
      <button type="button" class="icon" data-mv="1" aria-label="次の月" ${shown >= monthOf(today) ? 'disabled' : ''}>›</button>
    </div>
    <section class="card month-sum">
      <div><small>合計</small><b class="coin-num">${num(mt.earned)}</b><span class="muted small">プレミアムBOX ${boxes(mt.earned)}回分</span></div>
      ${goal ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, (mt.earned / goal) * 100))}%"></i></div><p class="muted small">目標 ${num(goal)}（${Math.floor((mt.earned / goal) * 100)}%）</p>` : ''}
      <div class="mini-stats">
        <span><small>記録した日</small>${recorded.length}日</span>
        <span><small>1日平均</small>${short(avg)}</span>
        <span><small>ベスト</small>${best ? `${short(days.get(best).earned)}` : '−'}</span>
        <span><small>ガチャ</small>${mt.draws}回</span>
      </div>
    </section>
    <section class="card cal">
      <div class="cal-head">${[...'日月火水木金土'].map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
      <p class="muted small cal-note"><i class="est-dot"></i>点線の日は、記録がなかったため前後の稼ぎを均等に分けた推定です</p>
    </section>`;

  view.querySelectorAll('[data-mv]').forEach(b =>
    b.addEventListener('click', () => {
      const d = new Date(y, m - 1 + Number(b.dataset.mv), 1);
      shown = ymd(d).slice(0, 7);
      render(view);
    }),
  );
  view.querySelectorAll('.cal-cell[data-k]').forEach(b => b.addEventListener('click', () => showDay(b.dataset.k, days, gains)));
}

function showDay(k, days, gains) {
  const d = days.get(k);
  if (!d) return;
  openSheet({
    title: dayLabel(k),
    html: `<div class="day-sum"><small>${d.estimated ? 'この日の稼ぎ（推定）' : 'この日の稼ぎ'}</small><b class="coin-num ${d.earned < 0 ? 'neg' : ''}">${signed(d.earned)}</b>
        ${d.draws ? `<span class="muted small">ガチャ ${d.draws}回（${num(d.spent)}枚）</span>` : ''}</div>
      ${
        d.records.length
          ? `<div class="list">${d.records
              .map(r => {
                const g = gains.get(r.id);
                return `<button type="button" class="row" data-id="${r.id}"><span class="row-time">${timeLabel(r.at)}</span>
                  <span class="row-main">${num(r.coins)}<small>枚</small></span>
                  <span class="row-gain ${g.gain < 0 ? 'neg' : ''}">${g.gain == null ? '<small class="muted">基準</small>' : signed(g.gain)}${g.spread > 1 ? `<small class="muted">${g.spread}日分</small>` : ''}</span></button>`;
              })
              .join('')}</div>`
          : `<p class="muted small">この日は記録がありません。次の記録の稼ぎを日数で分けて入れています。</p>`
      }`,
    onMount(sheet, close) {
      sheet.querySelectorAll('[data-id]').forEach(b =>
        b.addEventListener('click', () => {
          close();
          editRecord(state.records.find(r => r.id === b.dataset.id));
        }),
      );
    },
  });
}
