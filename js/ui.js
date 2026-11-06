// Bottom sheets, file picking and the "where is the coin count" frame.
import { esc } from './util.js';

/** Opens a sheet; resolves with the value passed to `close(value)` (null when dismissed). */
export function openSheet({ title, html, onMount, tall = false }) {
  // Close the keyboard first: iOS misjudges the screen height for a sheet opened while it is up.
  document.activeElement?.blur?.();
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'sheet-backdrop';
    ov.innerHTML = `<div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="txt" data-close>閉じる</button></div>
      <div class="sheet-body">${html}</div>
    </div>`;
    let done = false;
    const close = value => {
      if (done) return;
      done = true;
      ov.remove();
      if (!document.querySelector('.sheet-backdrop')) document.body.classList.remove('modal-open');
      resolve(value ?? null);
    };
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-close]')) close(null);
    });
    ov.close = close;
    document.body.append(ov);
    document.body.classList.add('modal-open');
    onMount?.(ov.querySelector('.sheet'), close);
  });
}

export const closeAllSheets = () => document.querySelectorAll('.sheet-backdrop').forEach(s => s.close?.(null));

/**
 * Opens the photo picker. Must be called straight from a tap (iOS only opens it then).
 * Resolves with the chosen file; stays pending if the picker is cancelled on older iOS.
 */
export function pickImage() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を開けませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Shows the screenshot with a draggable frame; resolves with the frame as 0..1 of the image
 * ({ x, y, w, h }) or null. Drag the corners to resize, the inside to move.
 */
export function chooseRegion(img, start) {
  return openSheet({
    title: 'コイン数の場所を選ぶ',
    tall: true,
    html: `<p class="hint">枠の四隅を動かして、<b>所持コインの数字だけ</b>を囲んでください。<br>場所は覚えるので、次からは自動で読み取ります。</p>
      <div class="crop-stage"><div class="crop-wrap"><img src="${img.src}" alt="" draggable="false">
        <div class="crop-box"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
      <button type="button" class="primary block" data-ok>この場所で読み取る</button>`,
    onMount(sheet, close) {
      const wrap = sheet.querySelector('.crop-wrap');
      const box = wrap.querySelector('.crop-box');
      const r = { ...(start || { x: 0.3, y: 0.06, w: 0.4, h: 0.05 }) };
      const MIN = 0.02;
      const draw = () => Object.assign(box.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
      draw();

      let drag = null;
      wrap.addEventListener('pointerdown', e => {
        const rect = wrap.getBoundingClientRect();
        drag = { mode: e.target.dataset.h || (e.target === box ? 'move' : null), sx: e.clientX, sy: e.clientY, rect, start: { ...r } };
        if (!drag.mode) return (drag = null);
        wrap.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      wrap.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = (e.clientX - drag.sx) / drag.rect.width;
        const dy = (e.clientY - drag.sy) / drag.rect.height;
        const s = drag.start;
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        if (drag.mode === 'move') {
          r.x = clamp(s.x + dx, 0, 1 - s.w);
          r.y = clamp(s.y + dy, 0, 1 - s.h);
        } else {
          const left = drag.mode.includes('w') ? clamp(s.x + dx, 0, s.x + s.w - MIN) : s.x;
          const right = drag.mode.includes('e') ? clamp(s.x + s.w + dx, s.x + MIN, 1) : s.x + s.w;
          const top = drag.mode.includes('n') ? clamp(s.y + dy, 0, s.y + s.h - MIN) : s.y;
          const bottom = drag.mode.includes('s') ? clamp(s.y + s.h + dy, s.y + MIN, 1) : s.y + s.h;
          Object.assign(r, { x: left, y: top, w: right - left, h: bottom - top });
        }
        draw();
      });
      const end = () => (drag = null);
      wrap.addEventListener('pointerup', end);
      wrap.addEventListener('pointercancel', end);
      sheet.querySelector('[data-ok]').addEventListener('click', () => close({ ...r }));
    },
  });
}

/** The framed part of the image as a canvas. */
export function cut(img, r) {
  const sx = r.x * img.naturalWidth;
  const sy = r.y * img.naturalHeight;
  const sw = Math.max(1, r.w * img.naturalWidth);
  const sh = Math.max(1, r.h * img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.round(sw);
  c.height = Math.round(sh);
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
