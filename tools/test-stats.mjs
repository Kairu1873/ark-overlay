// レベル別ステータスの自己チェック。
//
// ARK Smart Breeding の値（statsRaw）は近接攻撃・移動速度を倍率で持っているため、
// 表示用の % に直す向きを間違えやすい。Rex の既知の値で固定する。
//
//   node tools/test-stats.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { wildStatAt, wildGainPerLevel, roundStat } from '../src/data/stats.js';

const creatures = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'data', 'creatures.json'), 'utf8'),
);

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? '  OK ' : '  NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : `（期待 ${JSON.stringify(expected)}）`}`);
};
const of = (name) => creatures.find((c) => c.name === name);
const at = (creature, key, lv) => roundStat(wildStatAt(creature, key, lv));

console.log('Rex（Smart Breeding の値を持つ生物）');
{
  const rex = of('Rex');
  eq('体力の基礎値', at(rex, 'health', 0), 1100);
  eq('体力は1レベルごとに+220', roundStat(wildGainPerLevel(rex, 'health')), 220);
  eq('体力に10レベル振ると3300', at(rex, 'health', 10), 3300);
  // 近接攻撃と移動速度は倍率。ゲーム内の表示と同じ % に直す
  eq('近接攻撃は100%から', at(rex, 'damage', 0), 100);
  eq('近接攻撃は1レベルごとに+5%', roundStat(wildGainPerLevel(rex, 'damage')), 5);
  eq('近接攻撃に10レベル振ると150%', at(rex, 'damage', 10), 150);
  eq('移動速度は野生では伸びない', [at(rex, 'speed', 0), at(rex, 'speed', 100)], [100, 100]);
}

console.log('\nSmart Breeding に無い生物は Wiki の成長率で出す');
{
  const c = creatures.find((x) => !x.statsRaw && x.growth?.wild?.health && x.stats?.health);
  const base = c.stats.health;
  const per = c.growth.wild.health;
  eq(`${c.name} は基礎値＋増分で出す`, at(c, 'health', 10), roundStat(base + per * 10));
}

console.log('\n端の値');
{
  const rex = of('Rex');
  eq('レベル0と負値は基礎値', [at(rex, 'health', 0), at(rex, 'health', -5)], [1100, 1100]);
  eq('データの無いステータスは null', wildStatAt(rex, 'crafting', 10), null);
  eq('生物が無くても落ちない', wildStatAt(null, 'health', 10), null);
}

console.log(failed ? `\n${failed}件 失敗しました` : '\nすべて通りました');
process.exit(failed ? 1 : 0);
