// ARK Wiki から生物・アイテムのデータを集めて data/*.json を作る。
//
//   node tools/fetch-wiki.mjs [--dry-run] [--skip-ja] [--no-cache]
//
// アプリの実行時にWikiを叩くことはない。取得はこのスクリプト（= 週1のCI）だけが行う。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cargoQuery, fetchRightsInfo } from './sources/cargo.mjs';
import { fetchAllModules, MODULES } from './sources/modules.mjs';
import { fetchCreatures as fetchJaCreatures } from './sources/wikiwiki.mjs';
import { fetchJaNames } from './sources/arkja.mjs';
import { fetchAsbValues } from './sources/asb.mjs';
import { mergeCreatures, mergeItems, norm, resolveInherits, isAsaTarget } from './merge.mjs';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipJa = args.has('--skip-ja');

const CREATURE_FIELDS = [
  '_pageName', 'Name', 'InMod', 'IsVariant', 'ReleasedASA', 'Released', 'DLCs',
  'Tameable', 'Breedable', 'Rideable', 'Diet', 'Temperament', 'TaxonomicGroup',
  'Saddle', 'SaddleLevel', 'WildMaps', 'EntityId',
  'Incubation', 'IncubationMin', 'IncubationMax', 'Gestation', 'BabyTime',
];
const STAT_FIELDS = [
  '_pageName', 'variant', 'health1', 'stamina1', 'oxygen1', 'food1',
  'weight1', 'torpor1', 'damage1', 'speed1',
];
const ITEM_FIELDS = ['_pageName', 'ID', 'Blueprint', 'Category', 'stackSize', 'weight'];
const CRAFTABLE_FIELDS = [
  '_pageName', 'category', 'requiredLevel', 'engramPoints', 'craftingTime',
  'craftedIn', 'craftedIn2', 'craftedIn3', 'craftedIn4', 'craftedIn5', 'craftedIn6',
  ...Array.from({ length: 15 }, (_, i) => `ingredient${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `quantity${i + 1}`),
];
const CONSUMABLE_FIELDS = [
  '_pageName', 'AddsFood', 'AddsWater', 'AddsHealth', 'AddsStamina',
  'AddsTorpor', 'SpoilsIn', 'CookingTime',
];
const RESOURCE_FIELDS = ['_pageName', 'Rarity', 'Renewable', 'Refineable'];

const log = (msg) => console.log(msg);

async function main() {
  log('ARK Wiki からデータを取得します');
  if (dryRun) log('  （--dry-run: ファイルは書き込みません）');

  log('\n[1/6] Cargo テーブル');
  const creatures = await cargoQuery('Creatures', CREATURE_FIELDS);
  log(`  Creatures       ${creatures.length}`);
  const creatureStats = await cargoQuery('CreatureStats', STAT_FIELDS);
  log(`  CreatureStats   ${creatureStats.length}`);
  const items = await cargoQuery('Items', ITEM_FIELDS);
  log(`  Items           ${items.length}`);
  const craftables = await cargoQuery('Craftables', CRAFTABLE_FIELDS);
  log(`  Craftables      ${craftables.length}`);
  const consumables = await cargoQuery('Consumables', CONSUMABLE_FIELDS);
  log(`  Consumables     ${consumables.length}`);
  const resources = await cargoQuery('Resources', RESOURCE_FIELDS);
  log(`  Resources       ${resources.length}`);

  log('\n[2/6] Lua モジュール');
  const { dv, tamingCreatures, tamingFood, revisions } = await fetchAllModules();
  log(`  ${MODULES.dv}              ${Object.keys(dv).length} エントリ`);
  log(`  ${MODULES.tamingCreatures}  ${Object.keys(tamingCreatures).length} エントリ`);
  log(`  ${MODULES.tamingFood}       ${Object.keys(tamingFood).length} 品目`);

  // 日本語Wikiは対象生物だけ引く（736ページ全部は取らない）
  log('\n[3/6] 日本語Wiki（wikiwiki.jp/arksa）');
  const dvResolved = resolveInherits(dv);
  const dvByKey = new Map(Object.entries(dvResolved).map(([k, v]) => [norm(k), v]));
  const targetNames = creatures
    .filter((r) => isAsaTarget(r, dvByKey.get(norm(r.Name))))
    .map((r) => r.Name);
  let ja = {};
  let jaTimes = {};
  let jaDossierNames = {};
  let jaStats = {};
  if (skipJa) {
    log('  （--skip-ja: 取得を飛ばしました）');
  } else {
    const res = await fetchJaCreatures(targetNames, (done, total) => {
      if (done % 25 === 0 || done === total) log(`  ${done}/${total}`);
    });
    ja = res.data;
    jaTimes = res.times;
    jaDossierNames = res.names;
    jaStats = res.stats;
    log(`  ページ総数 ${res.available} / 対象と一致 ${res.attempted} / 定性情報 ${Object.keys(ja).length}`
      + ` / 繁殖時間 ${Object.keys(jaTimes).length} / ステータス ${Object.keys(jaStats).length}`);
  }

  // Smart Breeding はゲームファイルから抽出された値で、版番号が付いている。数値の第一ソース
  log('\n[4/6] Smart Breeding（ARKStatsExtractor）');
  const asbValues = await fetchAsbValues();
  log(`  ASA ${asbValues.versions.asa} / ASE ${asbValues.versions.ase} / 餌 ${asbValues.versions.food}`);
  log(`  種の定義 ${asbValues.counts.merged}（ASA ${asbValues.counts.asa} / ASE ${asbValues.counts.ase}）`);

  // 日本語名は日本語版の ark.wiki.gg から引く。英名のページがリダイレクトになっており、数リクエストで済む
  log('\n[5/6] 日本語名（ark.wiki.gg/ja）');
  const jaNames = await fetchJaNames(targetNames);
  const nameOverrides = await loadNameOverrides();
  log(`  日本語版と一致 ${Object.keys(jaNames).length}/${targetNames.length} / 手書きの補完 ${Object.keys(nameOverrides).length}`);

  log('\n[6/6] マージ');
  const merged = mergeCreatures({
    creatures, creatureStats, dv, tamingCreatures, ja, jaTimes,
    jaNames, jaDossierNames, jaStats, nameOverrides,
    asb: asbValues.byEntityId,
  });
  const mergedItems = mergeItems({ items, craftables, consumables, resources });
  report(merged);
  log(`  アイテム        ${mergedItems.stats.total}`);

  const rights = await fetchRightsInfo();
  const meta = {
    generatedAt: new Date().toISOString(),
    license: { name: rights.text, url: rights.url },
    sources: {
      'ark.wiki.gg': { cargo: { creatures: creatures.length, items: items.length }, modules: revisions },
      'ark.wiki.gg/ja': { names: Object.keys(jaNames).length },
      'ARKStatsExtractor': {
        versions: asbValues.versions,
        matched: merged.stats.asb.matched,
        breeding: merged.stats.asb.breeding,
        taming: merged.stats.asb.taming,
        stats: merged.stats.asb.stats,
      },
      'wikiwiki.jp/arksa': {
        creatures: Object.keys(ja).length,
        breedingTimes: Object.keys(jaTimes).length,
        filledGaps: merged.stats.jaFilled,
        skipped: skipJa,
      },
    },
    counts: { creatures: merged.creatures.length, items: mergedItems.items.length },
    // 両Wikiで値が食い違った箇所。どちらを採ったかも含めて残す
    conflicts: merged.stats.conflicts,
    statConflicts: merged.stats.statConflicts,
    // 2種の値が入れ替わっているとみられる組。この組では日本語Wikiを採らない
    suspectSwaps: merged.stats.swaps,
    // Wiki と Smart Breeding で食い違った数値（Smart Breeding を採用している）
    asbConflicts: merged.stats.asb.conflicts,
  };

  if (dryRun) {
    log('\n--dry-run のため書き込みを行いませんでした');
    return;
  }
  await mkdir(DATA_DIR, { recursive: true });
  await write('creatures.json', merged.creatures);
  await write('items.json', mergedItems.items);
  await write('taming-food.json', tamingFood);
  await write('meta.json', meta);
  log('\n完了');
}

/**
 * 手書きの日本語名（data/ja-names.json）を読む。
 * どちらの Wiki にも日本語名が無い生物を補うためのもので、ファイルが無くてもよい。
 */
async function loadNameOverrides() {
  try {
    const table = JSON.parse(await readFile(path.join(DATA_DIR, 'ja-names.json'), 'utf8'));
    return Object.fromEntries(
      Object.entries(table).filter(([, v]) => typeof v === 'string' && v.trim()),
    );
  } catch (e) {
    if (e.code !== 'ENOENT') log(`  ! data/ja-names.json を読めませんでした: ${e.message}`);
    return {};
  }
}

async function write(name, value) {
  const file = path.join(DATA_DIR, name);
  await writeFile(file, `${JSON.stringify(value, null, 1)}\n`);
  const kb = (Buffer.byteLength(JSON.stringify(value)) / 1024).toFixed(0);
  log(`  data/${name.padEnd(18)} ${kb} KB`);
}

function report({ creatures, stats }) {
  const has = (list, pick) => list.filter(pick).length;
  const pct = (n, d) => (d ? `${String(n).padStart(3)}/${String(d).padEnd(3)} (${String(Math.round((n / d) * 100)).padStart(3)}%)` : '  -');
  const line = (label, list) => {
    const breed = list.filter((c) => c.breedable);
    const tame = list.filter((c) => c.tameable);
    log(`  ${label.padEnd(12)} n=${String(list.length).padStart(3)}` +
      `  孵化/妊娠 ${pct(has(breed, (c) => c.breeding?.incubationSec ?? c.breeding?.gestationSec), breed.length)}` +
      `  成体 ${pct(has(breed, (c) => c.breeding?.maturationSec), breed.length)}` +
      `  交配CD ${pct(has(breed, (c) => c.breeding?.matingCooldownMinSec), breed.length)}` +
      `  テイム ${pct(has(tame, (c) => c.taming?.affinityBase), tame.length)}`);
  };
  log(`  Creatures ${stats.total} → ASA対象 ${stats.asa}（ASE由来 ${stats.ase} / ASA新規 ${stats.asaNew}）`);
  log(`  Dv/data と一致 ${stats.dvMatched} / 日本語Wikiと一致 ${stats.jaMatched} / 日本語で穴埋め ${stats.jaFilled}`);
  const n = stats.nameJa;
  log(`  日本語名 ${n.arkja + n.wikiwiki + n.manual}/${stats.asa}`
    + `（ark.wiki.gg/ja ${n.arkja} / ドシエ訳 ${n.wikiwiki} / 手書き ${n.manual} / なし ${n.none}）`);
  const a = stats.asb;
  log(`  Smart Breeding と一致 ${a.matched}/${stats.asa}`
    + `（繁殖を更新 ${a.breeding} / テイムを更新 ${a.taming} / ステータスを更新 ${a.stats}`
    + ` / 食い違い ${a.conflicts.length}件）`);
  const st = stats.statsSource;
  log(`  ステータス ${stats.asa - st.none}/${stats.asa}`
    + `（Smart Breeding ${st.asb} / 日本語Wiki ${st.ja} / 英語Wiki ${st.cargo} / なし ${st.none}）`);
  log(`  成長率 ${stats.growth} / 出現マップを日本語で補った生物 ${stats.mapsFromJa}`);
  line('ASA対象全体', creatures);
  line('ASE由来', creatures.filter((c) => c.origin === 'ase'));
  line('ASA新規', creatures.filter((c) => c.origin === 'asa'));
  if (a.conflicts.length) {
    log(`  Wiki と Smart Breeding の食い違い ${a.conflicts.length}件（Smart Breeding を採用）のうち差の大きいもの:`);
    const worst = [...a.conflicts]
      .filter((c) => Number.isFinite(c.wiki) && Number.isFinite(c.asb) && c.wiki > 0)
      .sort((x, y) => Math.abs(y.asb - y.wiki) / y.wiki - Math.abs(x.asb - x.wiki) / x.wiki)
      .slice(0, 10);
    for (const c of worst) log(`    ${c.name} ${c.field}: Wiki ${c.wiki} → ASB ${c.asb}`);
  }
  if (stats.swaps?.length) {
    log(`  2種の値が入れ替わっている疑い ${stats.swaps.length}組（この組は英語側を採用）:`);
    for (const p of stats.swaps) log(`    ${p.a} ⇔ ${p.b}（${p.fields.join(', ')}）`);
  }
  if (stats.conflicts?.length) {
    log(`  Wiki 同士で繁殖時間が食い違った箇所 ${stats.conflicts.length}件（この後 Smart Breeding で上書きされる場合がある）:`);
    for (const c of stats.conflicts) {
      log(`    ${c.name} ${c.field}: 英 ${c.en}秒 / 日 ${c.ja}秒 → ${c.adopted === 'ja' ? '日本語' : '英語'}を採用`);
    }
  }
  if (stats.statConflicts?.length) {
    log(`  Wiki 同士でステータスが食い違った箇所 ${stats.statConflicts.length}件（日本語を採用。この後 Smart Breeding で上書きされる場合がある）:`);
    for (const c of stats.statConflicts.slice(0, 15)) {
      log(`    ${c.name} ${c.field}: 英 ${c.en} / 日 ${c.ja}`);
    }
    if (stats.statConflicts.length > 15) log(`    …ほか ${stats.statConflicts.length - 15}件`);
  }
}

main().catch((e) => {
  console.error(`\n失敗しました: ${e.message}`);
  process.exit(1);
});
