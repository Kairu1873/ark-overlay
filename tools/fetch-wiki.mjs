// ARK Wiki から生物・アイテムのデータを集めて data/*.json を作る。
//
//   node tools/fetch-wiki.mjs [--dry-run] [--skip-ja] [--no-cache]
//
// アプリの実行時にWikiを叩くことはない。取得はこのスクリプト（= 週1のCI）だけが行う。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cargoQuery, fetchRightsInfo } from './sources/cargo.mjs';
import { fetchAllModules, MODULES } from './sources/modules.mjs';
import { fetchCreatures as fetchJaCreatures } from './sources/wikiwiki.mjs';
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

  log('\n[1/4] Cargo テーブル');
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

  log('\n[2/4] Lua モジュール');
  const { dv, tamingCreatures, tamingFood, revisions } = await fetchAllModules();
  log(`  ${MODULES.dv}              ${Object.keys(dv).length} エントリ`);
  log(`  ${MODULES.tamingCreatures}  ${Object.keys(tamingCreatures).length} エントリ`);
  log(`  ${MODULES.tamingFood}       ${Object.keys(tamingFood).length} 品目`);

  // 日本語Wikiは対象生物だけ引く（736ページ全部は取らない）
  log('\n[3/4] 日本語Wiki（wikiwiki.jp/arksa）');
  const dvResolved = resolveInherits(dv);
  const dvByKey = new Map(Object.entries(dvResolved).map(([k, v]) => [norm(k), v]));
  const targetNames = creatures
    .filter((r) => isAsaTarget(r, dvByKey.get(norm(r.Name))))
    .map((r) => r.Name);
  let ja = {};
  let jaTimes = {};
  if (skipJa) {
    log('  （--skip-ja: 取得を飛ばしました）');
  } else {
    const res = await fetchJaCreatures(targetNames, (done, total) => {
      if (done % 25 === 0 || done === total) log(`  ${done}/${total}`);
    });
    ja = res.data;
    jaTimes = res.times;
    log(`  ページ総数 ${res.available} / 対象と一致 ${res.attempted} / 定性情報 ${Object.keys(ja).length} / 繁殖時間 ${Object.keys(jaTimes).length}`);
  }

  log('\n[4/4] マージ');
  const merged = mergeCreatures({ creatures, creatureStats, dv, tamingCreatures, ja, jaTimes });
  const mergedItems = mergeItems({ items, craftables, consumables, resources });
  report(merged);
  log(`  アイテム        ${mergedItems.stats.total}`);

  const rights = await fetchRightsInfo();
  const meta = {
    generatedAt: new Date().toISOString(),
    license: { name: rights.text, url: rights.url },
    sources: {
      'ark.wiki.gg': { cargo: { creatures: creatures.length, items: items.length }, modules: revisions },
      'wikiwiki.jp/arksa': {
        creatures: Object.keys(ja).length,
        breedingTimes: Object.keys(jaTimes).length,
        filledGaps: merged.stats.jaFilled,
        skipped: skipJa,
      },
    },
    counts: { creatures: merged.creatures.length, items: mergedItems.items.length },
    // 両Wikiで値が食い違った箇所。英語側を採用しているが、後から追えるよう残す
    conflicts: merged.stats.conflicts,
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
  line('ASA対象全体', creatures);
  line('ASE由来', creatures.filter((c) => c.origin === 'ase'));
  line('ASA新規', creatures.filter((c) => c.origin === 'asa'));
  if (stats.conflicts?.length) {
    log(`  両Wikiで値が食い違った箇所 ${stats.conflicts.length}件（英語側を採用）:`);
    for (const c of stats.conflicts) log(`    ${c.name} ${c.field}: 英 ${c.en}秒 / 日 ${c.ja}秒`);
  }
}

main().catch((e) => {
  console.error(`\n失敗しました: ${e.message}`);
  process.exit(1);
});
