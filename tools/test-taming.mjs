// テイム計算の自己チェック。
//
// 期待値は英語Wikiが公開しているテイム表（Module:TamingTable の出力）から取っている。
// 数式を触ったときに Wiki と食い違ったら、ここが落ちる。
//
//   node tools/test-taming.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeRates } from '../src/data/rates.js';
import { tamingPlan } from '../src/data/taming.js';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');
const readJson = (name) => JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8'));
const creatures = readJson('creatures.json');
const food = readJson('taming-food.json');

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? '  OK ' : '  NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : `（期待 ${JSON.stringify(expected)}）`}`);
};

const of = (name) => creatures.find((c) => c.name === name);
/** 1行を「個数・秒・麻酔（ベリー/麻酔薬/バイオトキシン）」に畳む */
function line(creatureName, foodName, opt = {}) {
  const row = rowOf(creatureName, foodName, opt);
  if (!row) return null;
  const n = row.narcotics;
  return n ? [row.pieces, row.seconds, n.berry, n.narcotic, n.bioToxin] : [row.pieces, row.seconds];
}

function rowOf(creatureName, foodName, { level, rates, sanguineElixir } = {}) {
  const plan = tamingPlan(of(creatureName), food, {
    level,
    rates: normalizeRates(rates ?? {}),
    sanguineElixir,
  });
  return plan.rows.find((r) => r.food === foodName) ?? null;
}

console.log('Rex（気絶テイム）— 英語Wikiのテイム表と同じ値になること');
{
  // Lv150: 特上キブル 17個 00:36:14 / 麻酔0、羊肉 35個 01:10:00、ラムチョップ 65個 02:09:52 麻酔273/69/35
  eq('Lv150 キブル', line('Rex', 'Kibble', { level: 150 }), [17, 2174, 0, 0, 0]);
  eq('Lv150 羊肉', line('Rex', 'Raw Mutton', { level: 150 }), [35, 4200, 0, 0, 0]);
  eq('Lv150 ラムチョップ', line('Rex', 'Cooked Lamb Chop', { level: 150 }), [65, 7792, 273, 69, 35]);
  // Lv1 と Lv30 は level-1 の扱いと気絶値の式の回帰
  eq('Lv1 キブル', line('Rex', 'Kibble', { level: 1 }), [3, 384, 0, 0, 0]);
  eq('Lv1 生肉', line('Rex', 'Raw Meat', { level: 1 }), [18, 2160, 2, 1, 1]);
  eq('Lv30 キブル', line('Rex', 'Kibble', { level: 30 }), [5, 640, 0, 0, 0]);
  eq('Lv30 こんがり霜降り魚肉', line('Rex', 'Cooked Prime Fish Meat', { level: 30 }), [67, 4131, 66, 15, 8]);
}

console.log('\nEquus（平和テイム）— 起きたままの倍率が効くこと');
{
  const plan = tamingPlan(of('Equus'), food, { level: 150, rates: normalizeRates({}) });
  const kibble = plan.rows.find((r) => r.food === 'Kibble');
  eq('Lv150 キブルの個数と時間', [kibble.pieces, kibble.seconds], [12, 384]);
  eq('給餌間隔は34秒（Wiki表記 00:34）', Math.floor(kibble.feedingInterval), 34);
  eq('麻酔は出さない', kibble.narcotics, null);
  const rockarrot = plan.rows.find((r) => r.food === 'Rockarrot');
  eq('specialFoodValues の餌も出る', [rockarrot.pieces, rockarrot.seconds], [23, 1104]);
}

console.log('\nBasilosaurus — Wiki 側の補正（resultCorrection）が効くこと');
{
  const plan = tamingPlan(of('Basilosaurus'), food, { level: 150, rates: normalizeRates({}) });
  const kibble = plan.rows.find((r) => r.food === 'Kibble');
  eq('Lv150 キブル 14個 0:12:07', [kibble.pieces, kibble.seconds], [14, 727]);
  eq('給餌間隔は55秒（Wiki表記 00:55）', Math.floor(kibble.feedingInterval), 55);
}

console.log('\nサーバー倍率');
{
  eq('テイム速度2倍で個数が減る', line('Rex', 'Kibble', { level: 150, rates: { tamingSpeed: 2 } }), [9, 1151, 0, 0, 0]);
  eq('食料の減りが2倍で時間が縮む', line('Rex', 'Kibble', { level: 150, rates: { foodDrain: 2 } }), [17, 1087, 0, 0, 0]);
  eq('倍率0は1として扱う', line('Rex', 'Kibble', { level: 150, rates: { tamingSpeed: 0 } }), [17, 2174, 0, 0, 0]);
}

console.log('\nテイム効率とボーナスレベル — ARK Smart Breeding の式');
{
  // te = 1 / (1 + ineffectiveness × 個数 ÷ 餌1個のaffinity)
  const kibble = rowOf('Rex', 'Kibble', { level: 150 });
  eq('Lv150 キブルの効率', Math.round(kibble.effectiveness * 10000) / 10000, 0.9869);
  eq('Lv150 キブルのボーナスレベル', kibble.bonusLevel, 74);
  const mutton = rowOf('Rex', 'Raw Mutton', { level: 150 });
  eq('羊肉は効率が落ちる', Math.round(mutton.effectiveness * 10000) / 10000, 0.9449);
  eq('羊肉のボーナスレベル', mutton.bonusLevel, 70);
}

console.log('\n麻酔キノコと Sanguine Elixir');
{
  const chop = rowOf('Rex', 'Cooked Lamb Chop', { level: 150 });
  eq('麻酔キノコ（25 torpor / 3秒）', chop.narcotics.ascerbic, 126);
  // 必要 affinity が 0.7 倍になる → 個数と時間が減り、効率は上がる
  const elixir = rowOf('Rex', 'Kibble', { level: 150, sanguineElixir: true });
  eq('エリクサーありの個数と時間', [elixir.pieces, elixir.seconds], [12, 1535]);
  eq('エリクサーありの効率', Math.round(elixir.effectiveness * 10000) / 10000, 0.9907);
}

console.log('\n野生生物向けのサーバー倍率');
{
  eq('野生の食料の減りが2倍で時間が縮む',
    line('Rex', 'Kibble', { level: 150, rates: { wildFoodDrain: 2 } }), [17, 1087, 0, 0, 0]);
  const chop = rowOf('Rex', 'Cooked Lamb Chop', { level: 150, rates: { wildTorporDrain: 2 } });
  eq('野生の気絶値の減りが2倍で麻酔が増える', [chop.narcotics.narcotic, chop.narcotics.bioToxin], [295, 148]);
}

console.log('\nデータが無い生物');
{
  const plan = tamingPlan(of('Pyromane'), food, { level: 150, rates: normalizeRates({}) });
  eq('行は空', plan.rows.length, 0);
  eq('必要affinityも出さない', plan.affinityNeeded, null);
  const none = tamingPlan(null, food, { level: 150, rates: normalizeRates({}) });
  eq('生物が無くても落ちない', none.rows.length, 0);
}

console.log(failed ? `\n${failed}件 失敗しました` : '\nすべて通りました');
process.exit(failed ? 1 : 0);
