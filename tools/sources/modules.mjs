// ark.wiki.gg の Lua モジュールを生のまま取得して JS の値にする。
// Cargo に無い繁殖時間・テイム係数はここにしか無い。
import { fetchText, fetchJson } from '../http.mjs';
import { parseLuaModule } from '../lua-table.mjs';

const API = 'https://ark.wiki.gg/api.php';
const RAW = 'https://ark.wiki.gg/index.php';

export const MODULES = {
  dv: 'Module:Dv/data',
  tamingCreatures: 'Module:TamingTable/creatures',
  tamingFood: 'Module:TamingTable/food',
};

async function fetchModule(title) {
  const url = `${RAW}?${new URLSearchParams({ title, action: 'raw' })}`;
  const src = await fetchText(url);
  try {
    return parseLuaModule(src);
  } catch (e) {
    throw new Error(`${title} の解析に失敗しました: ${e.message}`);
  }
}

/** モジュールの最終更新リビジョンを取得する（data/meta.json に記録して更新検知に使う） */
async function fetchRevisions(titles) {
  const url = `${API}?${new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'revisions',
    rvprop: 'ids|timestamp',
    titles: titles.join('|'),
  })}`;
  const data = await fetchJson(url);
  const out = {};
  for (const page of Object.values(data.query?.pages ?? {})) {
    const rev = page.revisions?.[0];
    if (rev) out[page.title] = { revid: rev.revid, timestamp: rev.timestamp };
  }
  return out;
}

export async function fetchAllModules() {
  const [dv, tamingCreatures, tamingFood] = await Promise.all([
    fetchModule(MODULES.dv),
    fetchModule(MODULES.tamingCreatures),
    fetchModule(MODULES.tamingFood),
  ]);
  const revisions = await fetchRevisions(Object.values(MODULES));
  return { dv, tamingCreatures, tamingFood, revisions };
}
