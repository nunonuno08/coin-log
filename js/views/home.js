// Home: today's earning against the goal, this week and month, streak, last 7 days, record buttons.
import { state, latestRecord } from '../store.js';
import { analyze, todayKey, monthOf, monthTotal, monthGoal, weekOf, weekTotal, weekGoal, streak, boxes } from '../calc.js';
import { fromScreenshot, typeIn, editRecord, ICON_PHOTO, ICON_KEY } from '../record.js';
import { num, signed, short, addDays, weekday, timeLabel, parseYmd } from '../util.js';

const pct = (v, goal) => (goal > 0 ? Math.max(0, Math.min(100, (v / goal) * 100)) : 0);

function ring(p) {
  const C = 2 * Math.PI * 52;
  return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="52" class="ring-bg"/>
    <circle cx="60" cy="60" r="52" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p / 100)}"/></svg>`;
}

/** A total with its goal; tapping it opens the calendar (weeks are listed under the month). */
const goalTile = (title, v, goal, unit) =>
  `<a class="tile card" href="#/calendar"><small>${title}</small><b class="coin-num ${v < 0 ? 'neg' : ''}">${short(v)}</b>
    ${
      goal
        ? `<div class="bar"><i style="width:${pct(v, goal)}%"></i></div><span class="muted small">目標 ${short(goal)}・${Math.floor(pct(v, goal))}%</span>`
        : `<span class="muted small">${unit}の目標は未設定</span>`
    }</a>`;

export function render(view) {
  const { days, gains } = analyze();
  const today = todayKey();
  const d = days.get(today);
  const earned = d?.earned || 0;
  const dailyGoal = state.settings.dailyGoal;
  const month = monthOf(today);
  const mt = monthTotal(days, month);
  const mGoal = monthGoal(month);
  const wk = weekOf(today);
  const wt = weekTotal(days, wk);
  const wGoal = weekGoal(wk);
  const st = streak(days);
  const last = latestRecord();
  const dt = parseYmd(today);

  // Last 7 days, oldest first.
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map(k => ({ k, d: days.get(k) }));
  const max = Math.max(dailyGoal, ...week.map(w => w.d?.earned || 0), 1);

  const todayRecords = d?.records || [];
  const hasAny = state.records.length > 0;

  view.innerHTML = `
    <header class="top"><h1><span class="logo-coin"></span>コイン記録</h1>
      <span class="muted small">${dt.getMonth() + 1}月${dt.getDate()}日(${weekday(today)})</span></header>

    <section class="hero card">
      <div class="hero-ring">${ring(pct(earned, dailyGoal))}
        <div class="hero-in"><small>今日の稼ぎ</small><b class="coin-num ${earned < 0 ? 'neg' : ''}">${short(earned)}</b>
        ${dailyGoal ? `<span class="muted small">目標 ${short(dailyGoal)}</span>` : ''}</div></div>
      <div class="hero-side">
        ${
          !hasAny
            ? `<p class="small">まずは今の所持コインを記録しましょう。<br>次の記録から稼いだ分が出ます。</p>`
            : todayRecords.length
              ? `<p class="hero-box"><b>${boxes(earned)}</b><small>プレミアムBOX<br>回分</small></p>
                 ${dailyGoal ? `<p class="small">${earned >= dailyGoal ? '<span class="gold">目標達成！</span>' : `あと <b>${num(dailyGoal - earned)}</b>`}</p>` : '<a class="small link" href="#/settings">目標を決める →</a>'}`
              : `<p class="small muted">今日はまだ記録していません</p>`
        }
      </div>
    </section>

    <div class="rec-buttons">
      <button type="button" class="primary big" data-shot>${ICON_PHOTO}スクショから記録</button>
      <button type="button" class="big" data-type>${ICON_KEY}入力</button>
    </div>

    <section class="tiles">
      ${goalTile('今週の合計', wt.earned, wGoal, '週')}
      ${goalTile(`${dt.getMonth() + 1}月の合計`, mt.earned, mGoal, '月')}
    </section>
    <section class="card strip">
      <span><small>連続記録</small><b class="streak">${st}<span>日</span></b></span>
      <span><small>所持コイン</small><b class="coin-num">${last ? num(last.coins) : '−'}</b></span>
    </section>

    <section class="card week">
      <h2>最近7日</h2>
      <div class="bars">${week
        .map(({ k, d: w }) => {
          const v = w?.earned || 0;
          const h = Math.max(0, (v / max) * 100);
          return `<div class="bar-col ${k === today ? 'today' : ''} ${w?.estimated ? 'est' : ''}">
            <span class="bar-v">${v ? short(v) : ''}</span>
            <div class="bar-track"><i style="height:${h}%"></i></div>
            <span class="bar-d">${weekday(k)}</span></div>`;
        })
        .join('')}
        ${dailyGoal ? `<div class="goal-line" style="--g:${dailyGoal / max}"><span>目標</span></div>` : ''}
      </div>
    </section>

    ${
      todayRecords.length
        ? `<section><h3 class="sec">今日の記録</h3><div class="list card">${todayRecords
            .slice()
            .reverse()
            .map(r => {
              const g = gains.get(r.id);
              return `<button type="button" class="row" data-id="${r.id}"><span class="row-time">${timeLabel(r.at)}</span>
                <span class="row-main">${num(r.coins)}<small>枚</small></span>
                <span class="row-gain ${g.gain < 0 ? 'neg' : ''}">${g.gain == null ? '<small class="muted">基準</small>' : signed(g.gain)}</span></button>`;
            })
            .join('')}</div></section>`
        : ''
    }
  `;

  view.querySelector('[data-shot]').addEventListener('click', () => fromScreenshot());
  view.querySelector('[data-type]').addEventListener('click', () => typeIn());
  view.querySelectorAll('[data-id]').forEach(b =>
    b.addEventListener('click', () => editRecord(state.records.find(r => r.id === b.dataset.id))),
  );
}
