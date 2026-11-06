// Adding / fixing a coin reading: from a screenshot (main way) or typed in.
import { state, GACHA, saveRecord, deleteRecord, recordBefore, saveSettings } from './store.js';
import { spentOf } from './calc.js';
import { openSheet, pickImage, loadImage, chooseRegion, cut } from './ui.js';
import { readCoins } from './ocr.js';
import { uid, num, signed, digits, toLocalInput, dayLabel, timeLabel, ymd, toast } from './util.js';
import { nav } from './nav.js';

/**
 * Where the coin count sits on the game's main screens (home, ひろば, ranking all share the
 * top bar), by screen shape (width ÷ height), measured on the user's own screenshots.
 * The frame runs from just right of the coin icon to just left of the "+" button, so 8-digit
 * counts fit; taking in the "+" made it read an extra digit, the icon an extra "1".
 * Tested: every sample read right even with the frame moved ±0.8% sideways / ±0.4% up-down.
 */
const PRESETS = [
  { ratio: 1206 / 2622, frame: { x: 0.495, y: 0.165, w: 0.178, h: 0.038 } }, // iPhone (Face ID models)
  { ratio: 1640 / 2360, frame: { x: 0.488, y: 0.031, w: 0.18, h: 0.029 } }, // iPad
];

/**
 * A gain that is hard to believe, usually a misread number or a forgotten gacha: coins went
 * down although no gacha was entered, or went up faster than play allows (top coin earners
 * make about 4,500 a minute, so 500,000 an hour is a generous ceiling).
 */
function doubt(gain, ms) {
  if (gain < -20000) return '前回より減っています。ガチャの入れ忘れか、数字の読み間違いかもしれません。';
  const hours = Math.max(1, ms / 3600000);
  if (gain > 500000 * hours) return '前回から増えすぎています。数字の読み間違いかもしれません。';
  return '';
}

const shapeOf = img => img.naturalWidth / img.naturalHeight;
const shapeKey = img => shapeOf(img).toFixed(3);

/**
 * The frame to use: one the user chose for this screen shape, else a known preset,
 * else null (the user frames it once and it is remembered for this shape only).
 */
function startFrame(img) {
  const shape = shapeOf(img);
  const saved = Object.entries(state.settings.frames).find(([k]) => Math.abs(Number(k) - shape) < 0.004);
  if (saved) return saved[1];
  return PRESETS.find(p => Math.abs(p.ratio - shape) < 0.01)?.frame || null;
}

/** Main way: pick a screenshot, read the coin count where it was last time, confirm. */
export async function fromScreenshot() {
  const file = await pickImage(); // first thing, straight from the tap
  if (!file) return;
  let img;
  try {
    img = await loadImage(file);
  } catch (err) {
    return toast(err.message);
  }
  try {
    let rect = startFrame(img);
    for (;;) {
      if (!rect) {
        rect = await chooseRegion(img, startFrame(img) || PRESETS[0].frame);
        if (!rect) return;
        await saveSettings({ frames: { ...state.settings.frames, [shapeKey(img)]: rect } });
      }
      const canvas = cut(img, rect);
      const res = await editRecord(null, { canvas });
      if (res !== 'recrop') return;
      rect = null;
    }
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export const typeIn = () => editRecord(null, {});

/** Chooser used by the "+" button. Both buttons are real taps, so the photo picker can open. */
export function addMenu() {
  return openSheet({
    title: 'コインを記録',
    html: `<div class="add-menu">
      <button type="button" class="primary big" data-shot>${ICON_PHOTO}スクショから読み取る</button>
      <button type="button" class="big" data-type>${ICON_KEY}数字を入力する</button></div>`,
    onMount(sheet, close) {
      sheet.querySelector('[data-shot]').addEventListener('click', () => {
        const p = fromScreenshot();
        close();
        return p;
      });
      sheet.querySelector('[data-type]').addEventListener('click', () => {
        close();
        typeIn();
      });
    },
  });
}

export const ICON_PHOTO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/></svg>`;
export const ICON_KEY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>`;

/**
 * The form. `record` null = new. Resolves with 'recrop' when the user wants to frame the
 * number again, otherwise null.
 */
export function editRecord(record, { canvas } = {}) {
  const isNew = !record;
  const r = record ? structuredClone(record) : { id: uid(), at: Date.now(), coins: null, gacha: {}, prices: {}, source: canvas ? 'ocr' : 'manual' };
  let atTouched = false; // keep the exact time (seconds too) unless it is changed here

  const gachaRows = GACHA.map(
    g => `<div class="stepper" data-g="${g.key}">
      <span class="st-name">${g.name}<small>${num(r.prices[g.key] ?? state.settings.prices[g.key])}枚</small></span>
      <button type="button" class="st-btn" data-d="-1" aria-label="減らす">−</button>
      <b class="st-n">${r.gacha[g.key] || 0}</b>
      <button type="button" class="st-btn" data-d="1" aria-label="増やす">＋</button></div>`,
  ).join('');

  return openSheet({
    title: isNew ? 'コインを記録' : '記録を直す',
    tall: true,
    html: `${
      canvas
        ? `<div class="shot"><div class="shot-img"></div>
          <p class="shot-status muted small">読み取り中…</p>
          <div class="shot-alt"></div>
          <button type="button" class="txt small" data-recrop>数字の場所を選び直す</button></div>`
        : ''
    }
      <label class="field"><span>所持コイン</span>
        <div class="coin-input"><span class="coin-dot"></span><input type="text" inputmode="numeric" autocomplete="off" placeholder="例: 12,345,678" value="${r.coins != null ? num(r.coins) : ''}"><span class="unit">枚</span></div></label>
      <label class="field"><span>日時</span><input type="datetime-local" data-at value="${toLocalInput(r.at)}"></label>
      <div class="field"><span>前回の記録からガチャを引いた？</span><p class="prev-info muted small"></p>${gachaRows}</div>
      <div class="result"></div>
      <button type="button" class="primary block" data-save>${isNew ? '記録する' : '保存する'}</button>
      ${isNew ? '' : '<button type="button" class="danger block" data-del>この記録を削除</button>'}`,
    onMount(sheet, close) {
      const input = sheet.querySelector('.coin-input input');
      const atInput = sheet.querySelector('[data-at]');
      const result = sheet.querySelector('.result');
      const prevInfo = sheet.querySelector('.prev-info');
      let typed = !isNew;

      const coins = () => (digits(input.value) ? Number(digits(input.value)) : null);
      const at = () => (atTouched && atInput.value ? new Date(atInput.value).getTime() : r.at);

      const update = () => {
        const prev = recordBefore(at(), isNew ? null : r.id);
        prevInfo.textContent = prev ? `前回: ${dayLabel(ymd(new Date(prev.at)))} ${timeLabel(prev.at)}　${num(prev.coins)}枚` : 'これが最初の記録です（ここから計算を始めます）';
        const c = coins();
        if (c == null) return (result.innerHTML = '');
        if (!prev) return (result.innerHTML = `<p class="muted small center">次の記録から、稼いだコインが出ます</p>`);
        const spent = spentOf(r);
        const gain = c - prev.coins + spent;
        const warn = doubt(gain, at() - prev.at);
        result.innerHTML = `<div class="gain ${gain < 0 ? 'neg' : ''}"><small>この記録の稼ぎ</small><b>${signed(gain)}</b>
          <span class="muted small">増減 ${signed(c - prev.coins)}${spent ? `　＋ ガチャ ${num(spent)}` : ''}</span></div>
          ${warn ? `<p class="warn">⚠ ${warn}</p>` : ''}`;
      };

      input.addEventListener('input', () => {
        typed = true;
        update();
      });
      input.addEventListener('blur', () => coins() != null && (input.value = num(coins())));
      atInput.addEventListener('change', () => {
        atTouched = true;
        update();
      });
      sheet.querySelectorAll('.stepper').forEach(row => {
        row.addEventListener('click', e => {
          const b = e.target.closest('[data-d]');
          if (!b) return;
          const k = row.dataset.g;
          const n = Math.max(0, (r.gacha[k] || 0) + Number(b.dataset.d));
          r.gacha[k] = n;
          r.prices[k] = r.prices[k] ?? state.settings.prices[k];
          row.querySelector('.st-n').textContent = n;
          row.classList.toggle('on', n > 0);
          update();
        });
        row.classList.toggle('on', (r.gacha[row.dataset.g] || 0) > 0);
      });

      if (canvas) {
        const box = sheet.querySelector('.shot-img');
        canvas.className = 'shot-canvas';
        box.append(canvas);
        const status = sheet.querySelector('.shot-status');
        const alt = sheet.querySelector('.shot-alt');
        sheet.querySelector('[data-recrop]').addEventListener('click', () => close('recrop'));
        readCoins(canvas, msg => (status.textContent = msg), recordBefore(r.at)?.coins)
          .then(({ value, alternatives }) => {
            if (value == null) {
              status.textContent = '数字を読み取れませんでした。場所を選び直すか、数字を入力してください。';
              return;
            }
            status.textContent = '読み取りました。合っているか確認してください。';
            if (!typed) {
              input.value = num(value);
              update();
            }
            alt.innerHTML = alternatives.length
              ? `<span class="muted small">もしかして:</span> ${alternatives.map(v => `<button type="button" class="chip" data-v="${v}">${num(v)}</button>`).join('')}`
              : '';
          })
          .catch(err => (status.textContent = err.message));
        alt.addEventListener('click', e => {
          const b = e.target.closest('[data-v]');
          if (!b) return;
          input.value = num(Number(b.dataset.v));
          typed = true;
          update();
        });
      } else if (isNew) {
        setTimeout(() => input.focus(), 60);
      }

      sheet.querySelector('[data-save]').addEventListener('click', async () => {
        const c = coins();
        if (c == null) {
          toast('所持コインを入れてください');
          return input.focus();
        }
        r.coins = c;
        r.at = at();
        for (const g of GACHA) if (!r.gacha[g.key]) delete r.gacha[g.key], delete r.prices[g.key];
        await saveRecord(r);
        toast(isNew ? '記録しました' : '保存しました');
        close();
        nav.rerender();
      });
      sheet.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!confirm('この記録を削除しますか？')) return;
        await deleteRecord(r.id);
        toast('削除しました');
        close();
        nav.rerender();
      });

      update();
    },
  });
}

