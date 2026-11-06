// Every reading, newest first, grouped by day. Tap one to fix or delete it.
import { state } from '../store.js';
import { analyze } from '../calc.js';
import { editRecord } from '../record.js';
import { num, signed, dayLabel, timeLabel } from '../util.js';
import { GACHA } from '../store.js';

export function render(view) {
  const { days, gains } = analyze();
  const list = [...days.values()].filter(d => d.records.length).sort((a, b) => b.key.localeCompare(a.key));

  view.innerHTML = `
    <header class="top"><h1>記録一覧</h1><span class="muted small">${state.records.length}件</span></header>
    ${
      list.length
        ? list
            .map(
              d => `<section><h3 class="sec">${dayLabel(d.key)}<span class="sec-gain ${d.earned < 0 ? 'neg' : ''}">${signed(d.earned)}</span></h3>
              <div class="list card">${d.records
                .slice()
                .reverse()
                .map(r => {
                  const g = gains.get(r.id);
                  const gacha = GACHA.filter(x => r.gacha?.[x.key]).map(x => `${x.name.replace('ガチャ', '')}×${r.gacha[x.key]}`);
                  return `<button type="button" class="row" data-id="${r.id}"><span class="row-time">${timeLabel(r.at)}</span>
                    <span class="row-main">${num(r.coins)}<small>枚</small>${gacha.length ? `<em class="tag">${gacha.join('・')}</em>` : ''}</span>
                    <span class="row-gain ${g.gain < 0 ? 'neg' : ''}">${g.gain == null ? '<small class="muted">基準</small>' : signed(g.gain)}${g.spread > 1 ? `<small class="muted">${g.spread}日分</small>` : ''}</span></button>`;
                })
                .join('')}</div></section>`,
            )
            .join('')
        : `<p class="empty">まだ記録がありません。<br>ホームの「スクショから記録」から始めましょう。</p>`
    }`;

  view.querySelectorAll('[data-id]').forEach(b =>
    b.addEventListener('click', () => editRecord(state.records.find(r => r.id === b.dataset.id))),
  );
}
