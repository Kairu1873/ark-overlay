// 生物・アイテムデータの供給。
//
// - 同梱の data/*.json をそのまま使う（起動はこれだけで完結する）
// - 起動後に非同期で GitHub の raw を見に行き、新しければ userData に取り込む
// - 取得はレンダラではなくメインプロセスで行う（file:// からの外部アクセスを避けるため）
//
// 更新に失敗しても、遅くても、アプリは同梱データで普通に動く。
// 画面の描画をこの通信で待たせてはいけない。

const { app } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const RAW_BASE = 'https://raw.githubusercontent.com/Kairu1873/ark-timer/main/data';
const FILES = ['creatures.json', 'items.json', 'taming-food.json', 'meta.json'];
const BUNDLED_DIR = path.join(__dirname, '..', 'data');
// userData は app.setName の影響を受けるので、ready 前に確定させない
const cacheDir = () => path.join(app.getPath('userData'), 'data-cache');
const TIMEOUT_MS = 15000;

let cached = null; // 読み込み済みのデータ

async function readJson(dir, name) {
  return JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
}

/** キャッシュ側が同梱より新しければキャッシュを使う */
async function pickDir() {
  try {
    const [bundled, updated] = await Promise.all([
      readJson(BUNDLED_DIR, 'meta.json'),
      readJson(cacheDir(), 'meta.json'),
    ]);
    if (new Date(updated.generatedAt) > new Date(bundled.generatedAt)) return cacheDir();
  } catch (_) {
    /* キャッシュが無い・壊れている場合は同梱を使う */
  }
  return BUNDLED_DIR;
}

/** データを読む。失敗しても例外は投げず、空のデータを返す */
async function load() {
  const dir = await pickDir();
  try {
    const [creatures, items, tamingFood, meta] = await Promise.all([
      readJson(dir, 'creatures.json'),
      readJson(dir, 'items.json'),
      readJson(dir, 'taming-food.json'),
      readJson(dir, 'meta.json'),
    ]);
    return { creatures, items, tamingFood, meta, source: dir === BUNDLED_DIR ? 'bundled' : 'updated' };
  } catch (e) {
    console.error('データを読み込めませんでした:', e.message);
    return { creatures: [], items: [], tamingFood: {}, meta: null, source: 'none' };
  }
}

async function get() {
  if (!cached) cached = await load();
  return cached;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 更新を確認して、新しければ取り込む。
 * @returns {Promise<boolean>} 取り込んだら true
 */
async function checkUpdate() {
  const current = await get();
  const remote = await fetchJson(`${RAW_BASE}/meta.json`);
  if (!remote?.generatedAt) throw new Error('meta.json の形式が不正です');
  if (current.meta && new Date(remote.generatedAt) <= new Date(current.meta.generatedAt)) {
    return false;
  }

  // 全ファイルを取り切ってから書き込む。途中で失敗した中途半端な状態を残さない
  const fetched = {};
  for (const name of FILES) {
    fetched[name] = name === 'meta.json' ? remote : await fetchJson(`${RAW_BASE}/${name}`);
  }
  const dir = cacheDir();
  await fs.mkdir(dir, { recursive: true });
  for (const name of FILES) {
    await fs.writeFile(path.join(dir, name), JSON.stringify(fetched[name]));
  }
  cached = null;
  return true;
}

/**
 * 起動後に一度だけ更新を確認する。呼び出し元は待たない。
 * @param {(data:object)=>void} onUpdated 取り込めたときに新しいデータを渡す
 */
function checkUpdateInBackground(onUpdated) {
  setTimeout(() => {
    checkUpdate()
      .then(async (updated) => {
        if (updated) {
          console.log('データを更新しました');
          onUpdated?.(await get());
        }
      })
      .catch((e) => console.log(`データ更新の確認をやめました: ${e.message}`));
  }, 3000); // 起動直後の描画と通信を重ねない
}

module.exports = { get, checkUpdate, checkUpdateInBackground };
