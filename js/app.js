// Start-up and the four tabs (#/ home, #/calendar, #/history, #/settings).
import { load } from './store.js';
import { nav } from './nav.js';
import { toast } from './util.js';
import { closeAllSheets, restartedWhilePicking } from './ui.js';
import { addMenu } from './record.js';
import * as home from './views/home.js';
import * as calendar from './views/calendar.js';
import * as history from './views/history.js';
import * as settings from './views/settings.js';

const root = document.getElementById('app');
const fab = document.getElementById('fab');
const views = { '': home, calendar, history, settings };

function route() {
  closeAllSheets();
  const name = (location.hash || '#/').replace(/^#\/?/, '').split(/[/?]/)[0];
  const page = views[name];
  if (!page) return location.replace('#/');
  const view = document.createElement('div');
  view.className = 'view';
  root.replaceChildren(view);
  page.render(view);
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === (name || 'home')));
  // Home has its own big record buttons.
  fab.hidden = !(name === 'calendar' || name === 'history');
}

nav.rerender = () => {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
};

fab.addEventListener('click', () => addMenu());
window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});

// The day changes while the app stays open (or comes back from the background).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !document.body.classList.contains('modal-open')) nav.rerender();
});

// Anything that goes wrong is shown, never a silent "nothing happened".
window.addEventListener('error', e => toast(`問題が起きました: ${e.message}`, 6000));
window.addEventListener('unhandledrejection', e => toast(`問題が起きました: ${e.reason?.message || e.reason}`, 6000));

(async () => {
  try {
    await load();
  } catch (err) {
    root.innerHTML = `<div class="empty">データを読み込めませんでした。<br>${String(err.message || err)}</div>`;
    return;
  }
  route();
  if (restartedWhilePicking()) {
    toast('画像を選んでいる間に、iPhone がアプリを再起動したため読み込めませんでした。ほかのアプリを閉じてから、もう一度お試しください。', 8000);
  }
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    // A new version has just taken over: reload once so it shows right away instead of on the
    // next launch (not on the very first visit, and never under an open sheet).
    const updating = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updating || reloaded || document.body.classList.contains('modal-open')) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
