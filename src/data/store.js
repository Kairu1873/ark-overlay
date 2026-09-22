// 生物・アイテムデータの保持。
// 取得はメインプロセス側（electron/data.js）が行い、ここは受け取って検索するだけ。

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

const fold = (s) => String(s ?? '').toLowerCase();

/**
 * 生物を名前で探す。ARK は日本語版でも生物名が英語表記なので英名で引く。
 * @param {string} query
 * @param {{breedableOnly?: boolean, tameableOnly?: boolean, limit?: number}} opt
 */
export function searchCreatures(query, opt = {}) {
  const q = fold(query).trim();
  let list = data.creatures;
  if (opt.breedableOnly) list = list.filter((c) => c.breedable);
  if (opt.tameableOnly) list = list.filter((c) => c.tameable);
  if (!q) return list.slice(0, opt.limit ?? 50);

  const scored = [];
  for (const c of list) {
    const name = fold(c.name);
    let score;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (fold(c.group).includes(q)) score = 3;
    else continue;
    scored.push([score, c]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, opt.limit ?? 50).map(([, c]) => c);
}

export const findCreature = (key) => data.creatures.find((c) => c.key === key) ?? null;
