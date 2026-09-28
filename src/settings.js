// 設定の値そのものの扱い（画面に依存しない部分）。
//
// 見た目（背景の透過率）は画面側の state に、ウィンドウに関わるものはメインプロセス側に置く。
// ここでは保存された値を既定値で埋め、範囲外の値を丸める。

/** 背景の透過率（%）。100 で背景なし。文字の面は別に濃さを持つので、ここを上げても文字は読める */
export const TRANSPARENCY_MIN = 10;
export const TRANSPARENCY_MAX = 100;
export const TRANSPARENCY_DEFAULT = 70; // これまでの黒30%と同じ

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** 保存された見た目の設定を、欠けた値・壊れた値を既定で埋めて返す */
export function normalizeAppearance(a) {
  const t = Number(a?.transparency);
  return {
    transparency: Number.isFinite(t)
      ? clamp(Math.round(t), TRANSPARENCY_MIN, TRANSPARENCY_MAX)
      : TRANSPARENCY_DEFAULT,
  };
}

/** 透過率から背景の色を作る。透過率 70% なら黒30% */
export function backgroundColor(transparency) {
  const alpha = (100 - transparency) / 100;
  return `rgba(0, 0, 0, ${Number(alpha.toFixed(2))})`;
}
