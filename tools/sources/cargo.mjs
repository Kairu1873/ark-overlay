// ark.wiki.gg の Cargo テーブル（action=cargoquery）を取得する。
// 1回あたり最大500件しか返らないのでオフセットで繰り返す。
import { fetchJson } from '../http.mjs';

const API = 'https://ark.wiki.gg/api.php';
const PAGE = 500;

/**
 * Cargo テーブルを全件取得する。
 * @param {string} table 例 'Creatures'
 * @param {string[]} fields 取得するフィールド名
 * @returns {Promise<object[]>} 行の配列
 */
export async function cargoQuery(table, fields) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${API}?${new URLSearchParams({
      action: 'cargoquery',
      format: 'json',
      tables: table,
      fields: fields.join(','),
      limit: String(PAGE),
      offset: String(offset),
    })}`;
    const data = await fetchJson(url);
    const batch = (data.cargoquery ?? []).map((x) => x.title);
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
    // 取り漏らしより無限ループの方が怖いので上限を置く
    if (offset > 20000) throw new Error(`${table} の取得が終わりません`);
  }
}

/** Wiki のライセンス表記を取得する */
export async function fetchRightsInfo() {
  const url = `${API}?${new URLSearchParams({
    action: 'query',
    format: 'json',
    meta: 'siteinfo',
    siprop: 'rightsinfo',
  })}`;
  const data = await fetchJson(url);
  return data.query.rightsinfo;
}
