// 生物・アイテムデータの保持。
// 取得はメインプロセス側（electron/data.js）が行い、ここは受け取って検索するだけ。

import { fold, matchScore, NO_MATCH } from './text.js';

const desktop = typeof window !== 'undefined' ? window.arkOverlayDesktop : undefined;

let data = { creatures: [], items: [], tamingFood: {}, meta: null, source: 'none' };
const listeners = new Set();

export const getData = () => data;
export const getCreatures = () => data.creatures;
export const isLoaded = () => data.creatures.length > 0;

/** データが差し替わったときに呼ばれる */
export function onDataChanged(cb) {
  listeners.add(cb);
}
function emit() {
  for (const cb of listeners) cb(data);
}

export async function loadData() {
  if (!desktop?.getData) return data; // ブラウザで開いたときは生物機能なし
  try {
    data = await desktop.getData();
  } catch (e) {
    console.error('データを読み込めませんでした', e);
  }
  desktop.onDataUpdated?.((next) => {
    data = next;
    emit();
  });
  emit();
  return data;
}


/**
 * 読み込み済みの生物を名前で探す。英名でも日本語名でも引ける。
 * @param {string} query
 * @param {{breedableOnly?: boolean, tameableOnly?: boolean, limit?: number}} opt
 */
export const searchCreatures = (query, opt = {}) => searchIn(data.creatures, query, opt);

/**
 * 検索の中身。読み込み済みデータに依らないので、テストから直接呼べる。
 * @param {object[]} creatures
 * @param {string} query
 * @param {{breedableOnly?: boolean, tameableOnly?: boolean, limit?: number}} opt
 */
export function searchIn(creatures, query, opt = {}) {
  const q = fold(query);
  let list = creatures;
  if (opt.breedableOnly) list = list.filter((c) => c.breedable);
  if (opt.tameableOnly) list = list.filter((c) => c.tameable);
  if (!q) return list.slice(0, opt.limit ?? 50);

  const scored = [];
  for (const c of list) {
    // 英名と日本語名は同じ重みで見て、良い方を採る
    let score = Math.min(matchScore(fold(c.name), q), matchScore(fold(c.nameJa), q));
    if (score === NO_MATCH && fold(c.group).includes(q)) score = 3;
    if (score === NO_MATCH) continue;
    scored.push([score, c]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, opt.limit ?? 50).map(([, c]) => c);
}

export const findCreature = (key) => data.creatures.find((c) => c.key === key) ?? null;
