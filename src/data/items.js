// アイテムの検索と、選んだアイテムに共通する文字列の割り出し。
//
// ゲーム内のインベントリ検索欄に打つ文字列を作るためのもの。たとえば
// Raw Meat / Raw Prime Meat / Raw Mutton をまとめて絞り込みたいなら「Raw 」と打てばよい。
// 空白の有無で引っかかる件数が変わるので、候補は一致件数つきで並べる。

import { fold, matchScore, NO_MATCH } from './text.js';

/**
 * アイテムを名前で探す。英名でも日本語名でも引ける。
 * 完全一致 → 前方一致 → 部分一致 → カテゴリ一致の順。
 * @param {object[]} items data/items.json
 * @param {string} query
 * @param {{limit?: number}} opt
 */
export function searchItems(items, query, { limit = 80 } = {}) {
  const list = Array.isArray(items) ? items : [];
  const q = fold(query);
  if (!q) return list.slice(0, limit);

  const scored = [];
  for (const item of list) {
    if (!item?.name) continue;
    // 英名と日本語名は同じ重みで見て、良い方を採る
    let score = Math.min(matchScore(fold(item.name), q), matchScore(fold(item.nameJa), q));
    if (score === NO_MATCH && fold(item.category).includes(q)) score = 3;
    if (score === NO_MATCH) continue;
    scored.push([score, item]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, item]) => item);
}

/** 英名の照合だけに使う、単純な小文字化 */
const lower = (s) => String(s ?? '').toLowerCase();

/** text を英名に含むアイテムの数 */
export function countMatches(allNames, text) {
  const needle = lower(text);
  if (!needle) return 0;
  let n = 0;
  for (const name of allNames) if (lower(name).includes(needle)) n++;
  return n;
}

/**
 * 選んだ名前すべてに共通する文字列の候補を出す。
 *
 * より長い候補と一致件数が同じで、かつその中に含まれている候補は捨てる。
 * 「Raw 」で9件に絞れるなら、同じ9件しか拾わない短い候補を出しても選ぶ意味がないため。
 *
 * @param {string[]} selectedNames 選択したアイテムの英名
 * @param {string[]} allNames 全アイテムの英名（一致件数を数えるのに使う）
 * @param {{min?: number, limit?: number}} opt
 * @returns {{text: string, hits: number}[]} 絞り込める順（一致件数の少ない順）
 */
export function commonStrings(selectedNames, allNames, { min = 2, limit = 8 } = {}) {
  const names = (selectedNames ?? []).filter((n) => typeof n === 'string' && n.length);
  if (!names.length) return [];

  // 一番短い名前の部分文字列だけ調べれば足りる
  const shortest = names.reduce((a, b) => (a.length <= b.length ? a : b));
  const others = names.filter((n) => n !== shortest).map(lower);

  const seen = new Set();
  const candidates = [];
  for (let start = 0; start < shortest.length; start++) {
    for (let end = shortest.length; end - start >= min; end--) {
      const text = shortest.slice(start, end);
      const key = lower(text);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!others.every((n) => n.includes(key))) continue;
      candidates.push(text);
    }
  }

  candidates.sort((a, b) => b.length - a.length || a.localeCompare(b));

  const kept = [];
  for (const text of candidates) {
    const hits = countMatches(allNames ?? [], text);
    // より長い候補と同じ件数しか拾えないなら、短いほうは出さない
    if (kept.some((k) => k.hits === hits && lower(k.text).includes(lower(text)))) continue;
    kept.push({ text, hits });
  }
  // 一番絞り込めるものから並べる。件数が同じなら打つのが楽な短いほうを先に
  kept.sort((a, b) => a.hits - b.hits || a.text.length - b.text.length || a.text.localeCompare(b.text));
  return kept.slice(0, limit);
}
