// 設定画面。上部の ⚙ から開く。
//
// 背景の透過率は画面だけで完結するので、ほかの画面と同じ state（localStorage）に置く。
// クリック透過とショートカットは窓に関わるので、メインプロセスが持つ。

import { normalizeAppearance, backgroundColor, toAccelerator } from '../settings.js';

const $ = (sel) => document.querySelector(sel);

/** 見た目の設定を画面に当てる */
function applyAppearance(a) {
  document.documentElement.style.setProperty('--bg', backgroundColor(a.transparency));
}

export function initSettings({ state, save }) {
  state.appearance = normalizeAppearance(state.appearance);
  applyAppearance(state.appearance);

  const slider = $('#setTransparency');
  const value = $('#setTransparencyValue');
  const show = () => {
    slider.value = state.appearance.transparency;
    value.textContent = `${state.appearance.transparency}%`;
  };
  show();
  slider.addEventListener('input', () => {
    state.appearance = normalizeAppearance({ ...state.appearance, transparency: slider.value });
    applyAppearance(state.appearance);
    show();
    save();
  });

  initWindowSettings();
}

/**
 * ウィンドウに関わる設定。値はメインプロセスが持つので、ここでは送って、返ってきた状態を映すだけ。
 * ブラウザで開いたときは窓を操作できないので出さない。
 */
function initWindowSettings() {
  const desktop = window.arkOverlayDesktop?.window;
  if (!desktop) return;
  $('#setWindow').hidden = false;

  const through = $('#setClickThrough');
  const show = ({ clickThrough }) => {
    for (const b of through.querySelectorAll('[data-through]')) {
      b.classList.toggle('on', b.dataset.through === String(Boolean(clickThrough)));
    }
  };
  through.addEventListener('click', (e) => {
    const b = e.target.closest('[data-through]');
    if (b) desktop.setClickThrough(b.dataset.through === 'true');
  });
  // トレイから切り替えられたときも表示を合わせる
  desktop.onStateChanged?.(show);
  desktop.getState?.().then(show);

  initShortcut(desktop);
}

const SHORTCUT_HINT =
  '欄を押してから、使いたい組み合わせを押す（Ctrl・Alt のどちらかと一緒に）。ゲームを操作している最中でも効く';

/** クリック透過を切り替えるショートカット。欄を押してからキーを押すと取り込む */
function initShortcut(desktop) {
  const input = $('#setShortcut');
  const msg = $('#shortcutMsg');
  const say = (text, error = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', error);
  };
  const show = ({ shortcut, shortcutUnavailable }) => {
    input.value = shortcut ?? '';
    if (shortcutUnavailable) say(`${shortcutUnavailable} はほかのアプリが使っていて登録できなかった。別のキーにする`, true);
  };
  const apply = async (accel) => {
    const r = await desktop.setShortcut(accel);
    input.value = r.shortcut ?? '';
    if (r.ok) say(accel ? `${accel} で切り替わる` : 'ショートカットを使わない');
    else say(`${accel} はほかのアプリが使っていて登録できない。別の組み合わせにする`, true);
  };

  input.addEventListener('focus', () => {
    input.placeholder = 'キーを押す…';
    say(SHORTCUT_HINT);
  });
  input.addEventListener('blur', () => (input.placeholder = 'なし'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') return; // フォーカスの移動は奪わない
    e.preventDefault();
    if (e.key === 'Escape') return input.blur();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // 組み合わせの途中
    const accel = toAccelerator(e);
    if (!accel) return say('Ctrl か Alt と一緒に、英字・数字・F キーなどを押す', true);
    apply(accel);
    input.blur();
  });
  $('#clearShortcut').addEventListener('click', () => apply(null));

  desktop.onStateChanged?.(show);
  desktop.getState?.().then(show);
}
