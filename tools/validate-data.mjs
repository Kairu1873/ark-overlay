// data/*.json の妥当性を検査する。CI ではこれが落ちたらコミットしない。
//
// 壊れた JSON を黙ってコミットするのが一番まずい失敗なので、
// 「件数が大きく減った」「必須の値が消えた」「単位が変わった」を機械的に弾く。

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');

// 下限値。取得時点の実績から余裕を持たせてある。
// Wiki側の改修で構造が変わると件数が急減するので、その検知が目的。
const FLOOR = {
  creatures: 180,
  items: 2000,
  withMaturation: 115,
  withTaming: 90,
  tamingFood: 20,
  // ASA新規生物の数値は日本語Wikiだけが供給源。
  // wikiwiki.jp の書式が変わるとここが静かにゼロになるので、下限を置いて検知する
  jaFilled: 20,
  // 日本語名は ark.wiki.gg 日本語版のリダイレクトに頼っている。
  // 向こうの構成が変わると静かに全滅するので、下限を置いて検知する
  withNameJa: 150,
  // ステータス・成長率・出現マップは日本語Wikiの表の書式に頼っている。
  // 表が組み替えられると読めなくなるので、同じく下限を置く
  withStats: 170,
  withGrowth: 140,
  withMaps: 160,
};

const problems = [];
const fail = (msg) => problems.push(msg);

const readJson = async (name) => JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8'));

// 値が入っているべき場所に NaN / undefined が紛れていないか
function checkNoBadNumbers(node, trail) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => checkNoBadNumbers(v, `${trail}[${i}]`));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) checkNoBadNumbers(v, `${trail}.${k}`);
  } else if (typeof node === 'number' && !Number.isFinite(node)) {
    fail(`${trail} が有限の数値ではありません: ${node}`);
  }
}

async function main() {
  const creatures = await readJson('creatures.json');
  const items = await readJson('items.json');
  const tamingFood = await readJson('taming-food.json');
  const meta = await readJson('meta.json');

  // --- 件数 ---
  if (!Array.isArray(creatures)) fail('creatures.json が配列ではありません');
  if (creatures.length < FLOOR.creatures) {
    fail(`生物の件数が少なすぎます: ${creatures.length} < ${FLOOR.creatures}`);
  }
  if (items.length < FLOOR.items) {
    fail(`アイテムの件数が少なすぎます: ${items.length} < ${FLOOR.items}`);
  }
  if (Object.keys(tamingFood).length < FLOOR.tamingFood) {
    fail(`テイム用の餌が少なすぎます: ${Object.keys(tamingFood).length} < ${FLOOR.tamingFood}`);
  }

  // --- 形 ---
  for (const c of creatures) {
    const at = `creature[${c?.name ?? '?'}]`;
    if (!c.key || !c.name) fail(`${at} に key / name がありません`);
    if (c.origin !== 'ase' && c.origin !== 'asa') fail(`${at} の origin が不正です: ${c.origin}`);
    // 空オブジェクトを残すと「データがある」と誤認するので null であること
    for (const f of ['breeding', 'taming', 'stats', 'ja']) {
      if (c[f] !== null && typeof c[f] === 'object' && Object.keys(c[f]).length === 0) {
        fail(`${at}.${f} が空オブジェクトです（null であるべき）`);
      }
    }
    // 秒数がゼロだとタイマーが即発火する。欠損は null で表すこと
    for (const f of ['incubationSec', 'gestationSec', 'maturationSec']) {
      if (c.breeding?.[f] === 0) fail(`${at}.breeding.${f} が 0 です（欠損は null であるべき）`);
    }
  }
  checkNoBadNumbers(creatures, 'creatures');
  checkNoBadNumbers(items, 'items');

  // --- 充足率 ---
  const withMaturation = creatures.filter((c) => c.breeding?.maturationSec).length;
  const withTaming = creatures.filter((c) => c.taming?.affinityBase).length;
  if (withMaturation < FLOOR.withMaturation) {
    fail(`成体までの時間を持つ生物が少なすぎます: ${withMaturation} < ${FLOOR.withMaturation}`);
  }
  if (withTaming < FLOOR.withTaming) {
    fail(`テイム係数を持つ生物が少なすぎます: ${withTaming} < ${FLOOR.withTaming}`);
  }
  const withNameJa = creatures.filter((c) => c.nameJa).length;
  if (withNameJa < FLOOR.withNameJa) {
    fail(
      `日本語名を持つ生物が少なすぎます: ${withNameJa} < ${FLOOR.withNameJa}` +
        '（ark.wiki.gg 日本語版の構成が変わった可能性がある）',
    );
  }
  // 英名をそのまま日本語名として拾ってしまっていないか
  for (const c of creatures) {
    if (c.nameJa && !/[ぁ-んァ-ヶ一-龥]/.test(c.nameJa)) {
      fail(`creature[${c.name}].nameJa に日本語が含まれていません: ${c.nameJa}`);
    }
  }

  const withStats = creatures.filter((c) => c.stats).length;
  const withGrowth = creatures.filter((c) => c.growth).length;
  const withMaps = creatures.filter((c) => c.wildMaps?.length).length;
  if (withStats < FLOOR.withStats) {
    fail(`ステータスを持つ生物が少なすぎます: ${withStats} < ${FLOOR.withStats}`);
  }
  if (withGrowth < FLOOR.withGrowth) {
    fail(
      `成長率を持つ生物が少なすぎます: ${withGrowth} < ${FLOOR.withGrowth}` +
        '（日本語Wikiの「基礎値と成長率」表の書式が変わった可能性がある）',
    );
  }
  if (withMaps < FLOOR.withMaps) {
    fail(`出現マップを持つ生物が少なすぎます: ${withMaps} < ${FLOOR.withMaps}`);
  }

  // 成長率が基礎値を超えるのは、表記の揺れを読み違えたとき（「+2,75」を275と読むなど）に起きる。
  // 落とすほどではないが黙って通すと気づけないので、件数を出す
  const oddGrowth = [];
  for (const c of creatures) {
    for (const [field, per] of Object.entries(c.growth?.wild ?? {})) {
      const base = c.stats?.[field];
      if (Number.isFinite(base) && Number.isFinite(per) && base > 0 && per > base) {
        oddGrowth.push(`${c.name}.${field}（基礎 ${base} / 成長 ${per}）`);
      }
    }
  }

  const jaFilled = creatures.filter((c) => (c.sources?.breeding ?? '').includes('ja(')).length;
  if (jaFilled < FLOOR.jaFilled) {
    fail(
      `日本語Wikiで穴埋めできた生物が少なすぎます: ${jaFilled} < ${FLOOR.jaFilled}` +
        '（wikiwiki.jp の書式が変わった可能性がある）',
    );
  }

  // --- 単位の回帰テスト ---
  // Cargo の BabyTime（幼体期のみ）と Dv/data の maturationtime を取り違えると10倍ずれる。
  // Rex の既知の値で固定しておく。
  const rex = creatures.find((c) => c.key === 'rex');
  if (!rex) {
    fail('Rex が見つかりません');
  } else {
    const near = (a, b) => a !== null && a !== undefined && Math.abs(a - b) / b < 0.01;
    if (!near(rex.breeding?.incubationSec, 17998.56)) {
      fail(`Rex の孵化時間が想定外です: ${rex.breeding?.incubationSec}（期待 17998.56 秒）`);
    }
    if (!near(rex.breeding?.maturationSec, 333333.31)) {
      fail(`Rex の成体までの時間が想定外です: ${rex.breeding?.maturationSec}（期待 333333.31 秒。33333 なら BabyTime と取り違えている）`);
    }
    if (!near(rex.breeding?.matingCooldownMinSec, 64800)) {
      fail(`Rex の交配クールダウンが想定外です: ${rex.breeding?.matingCooldownMinSec}（期待 64800 秒）`);
    }
    // ステータスは日本語Wikiの表から採っている。列を取り違えると成長率を拾ってしまうため、
    // 両Wikiで一致している Rex の値で固定する
    for (const [field, expected] of [['health', 1100], ['weight', 500], ['torpor', 1550], ['speed', 100]]) {
      if (rex.stats?.[field] !== expected) {
        fail(`Rex の${field}が想定外です: ${rex.stats?.[field]}（期待 ${expected}）`);
      }
    }
  }

  // --- メタ情報 ---
  if (!meta.generatedAt) fail('meta.json に generatedAt がありません');
  if (!meta.license?.name) fail('meta.json に license がありません');

  // --- 結果 ---
  const asaNew = creatures.filter((c) => c.origin === 'asa').length;
  console.log(`生物 ${creatures.length}件（ASE由来 ${creatures.length - asaNew} / ASA新規 ${asaNew}）`);
  console.log(`  成体までの時間あり ${withMaturation} / テイム係数あり ${withTaming} / 日本語Wikiで穴埋め ${jaFilled}`);
  console.log(`  日本語名あり ${withNameJa} / ステータスあり ${withStats} / 成長率あり ${withGrowth} / 出現マップあり ${withMaps}`);
  if (oddGrowth.length) {
    console.log(`  成長率が基礎値を超えている箇所 ${oddGrowth.length}件: ${oddGrowth.slice(0, 5).join(' / ')}`);
  }
  if (meta.suspectSwaps?.length) {
    console.log(`  2種の値が入れ替わっている疑い ${meta.suspectSwaps.length}組（英語側を採用）`);
  }
  if (meta.statConflicts?.length) {
    console.log(`  ステータスが両Wikiで食い違い ${meta.statConflicts.length}件（日本語を採用）`);
  }
  if (meta.conflicts?.length) {
    const ja = meta.conflicts.filter((c) => c.adopted === 'ja').length;
    console.log(`  繁殖時間が両Wikiで食い違い ${meta.conflicts.length}件（日本語を採用 ${ja} / 英語を採用 ${meta.conflicts.length - ja}）`);
  }
  console.log(`アイテム ${items.length}件 / テイム用の餌 ${Object.keys(tamingFood).length}品目`);
  console.log(`生成日時 ${meta.generatedAt}`);

  if (problems.length) {
    console.error(`\n検証に失敗しました（${problems.length}件）:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('\n検証OK');
}

main().catch((e) => {
  console.error(`検証を実行できませんでした: ${e.message}`);
  process.exit(1);
});
