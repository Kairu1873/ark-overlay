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
}
