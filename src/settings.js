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

/**
 * 押したキーを Electron のショートカット表記（`Alt+Shift+X`）に直す。使えない組み合わせなら null。
 *
 * ゲーム中の操作を奪わないよう、Ctrl・Alt・Win のどれかを含むものだけ受ける（Shift だけでは足りない）。
 * キーは配列に左右されない物理位置（KeyboardEvent.code）で見る。記号キーは日本語配列と
 * 英語配列で刻印がずれて表記が合わなくなるので、英字・数字・F キー・移動系に絞る。
 *
 * @param {{code: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean}} e
 * @returns {string|null}
 */
export function toAccelerator(e) {
  const key = keyName(e?.code ?? '');
  if (!key || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  return [...mods, key].join('+');
}

const NAMED_KEYS = {
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
};

/** KeyboardEvent.code を Electron のキー名に。修飾キーそのものや対象外のキーは null */
function keyName(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
  if ((m = /^Numpad([0-9])$/.exec(code))) return `num${m[1]}`;
  if ((m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code))) return `F${m[1]}`;
  return NAMED_KEYS[code] ?? null;
}

/** 透過率から背景の色を作る。透過率 70% なら黒30% */
export function backgroundColor(transparency) {
  const alpha = (100 - transparency) / 100;
  return `rgba(0, 0, 0, ${Number(alpha.toFixed(2))})`;
}
