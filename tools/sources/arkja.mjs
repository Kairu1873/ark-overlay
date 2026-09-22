// ark.wiki.gg の日本語版（/ja）から生物の日本語名を取る。
//
// 日本語版には英名のリダイレクトページが置いてある（Rex → ティラノサウルス）ため、
// action=query&redirects=1 でリダイレクト先の題名を読むだけで名前が分かる。
// 40件ずつまとめて引けるので、207件でも数リクエストで終わる。
import { fetchJson } from '../http.mjs';

const API = 'https://ark.wiki.gg/ja/api.php';
const BATCH = 40;

/** 日本語（かな・漢字）を含むか。英名のままのページを弾くのに使う */
const hasJa = (s) => /[ぁ-んァ-ヶ一-龥]/.test(String(s ?? ''));

/**
 * 英名 → 日本語名の対応を作る。日本語ページが無いものは入れない。
 * @param {string[]} names 英名（英語Wikiの Name をそのまま使える）
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<Record<string,string>>}
 */
export async function fetchJaNames(names, onProgress) {
  const out = {};
  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    const url = `${API}?${new URLSearchParams({
      action: 'query',
      format: 'json',
      redirects: '1',
      titles: batch.join('|'),
    })}`;
    const query = (await fetchJson(url)).query ?? {};
    // API は題名を正規化してからリダイレクトを辿るので、同じ順でこちらも辿る
    const normalized = Object.fromEntries((query.normalized ?? []).map((x) => [x.from, x.to]));
    const redirects = Object.fromEntries((query.redirects ?? []).map((x) => [x.from, x.to]));
    const missing = new Set(
      Object.values(query.pages ?? {}).filter((p) => 'missing' in p).map((p) => p.title),
    );

    for (const name of batch) {
      const normed = normalized[name] ?? name;
      const title = redirects[normed] ?? normed;
      // ページが無い／英名のまま（= 未翻訳、もしくは Mobile: などの別名前空間）は拾わない
      if (missing.has(title) || !hasJa(title)) continue;
      out[name] = title;
    }
    onProgress?.(Math.min(i + BATCH, names.length), names.length);
  }
  return out;
}
