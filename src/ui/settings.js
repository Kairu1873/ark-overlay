// 設定画面。上部の ⚙ から開く。
//
// 背景の透過率は画面だけで完結するので、ほかの画面と同じ state（localStorage）に置く。

import { normalizeAppearance, backgroundColor } from '../settings.js';

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
}
