// Small shared helpers: escaping, number / date formatting, toast.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

export const pad = n => String(n).padStart(2, '0');

/** 1234567 → "1,234,567" */
export const num = n => Math.round(n).toLocaleString('ja-JP');

/** +150,000 / −20,000 */
export const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + num(Math.abs(n));

/** Compact amounts for small spaces: 152300 → "15.2万", 3200 → "3,200" */
export function short(n) {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  const t = v => String(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  if (a >= 1e8) return s + t(a / 1e8) + '億';
  if (a >= 1e4) return s + t(a / 1e4) + '万';
  return s + num(a);
}

/** Digits only, full-width digits included ("１,２３４" → "1234"). */
export const digits = s => String(s ?? '').normalize('NFKC').replace(/\D/g, '');

export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

const WD = '日月火水木金土';
export const weekday = s => WD[parseYmd(s).getDay()];
export function dayLabel(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}
export function timeLabel(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}
/** Value for <input type="datetime-local"> */
export function toLocalInput(ms) {
  const d = new Date(ms);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
