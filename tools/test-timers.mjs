// タイマー計算の自己チェック。
// 倍率の効く向きを間違えても画面上は「それらしい数字」が出てしまうので、
// 既知の値で固定しておく。
//
//   node tools/test-timers.mjs

import { normalizeRates, applyRate } from '../src/data/rates.js';
import { timersFor, matingCooldownMax, CUDDLE_BASE_SEC } from '../src/data/resolve.js';

let failed = 0;
const eq = (label, actual, expected, tol = 0.5) => {
  const ok = actual !== null && Math.abs(actual - expected) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? '  OK ' : '  NG '} ${label}: ${actual} ${ok ? '' : `（期待 ${expected}）`}`);
};

// Rex の既知の値（1x基準・秒）
const rex = {
  key: 'rex',
  name: 'Rex',
  breedable: true,
  breeding: {
    incubationSec: 17998.56,
    gestationSec: null,
    maturationSec: 333333.31,
    matingCooldownMinSec: 64800,
    matingCooldownMaxSec: 172800,
  },
};
const rowOf = (rows, field) => rows.find((r) => r.field === field)?.seconds ?? null;

console.log('倍率がすべて 1 のとき');
{
  const r = normalizeRates({});
  const rows = timersFor(rex, r, null);
  eq('孵化 = 17998.56秒（4:59:58）', rowOf(rows, 'incubationSec'), 17998.56);
  eq('成体まで = 333333.31秒（3日20:35:33）', rowOf(rows, 'maturationSec'), 333333.31);
  // タイマーは確実に明けている最長側で鳴らす。最短側は表示用に持つ
  eq('交配CDのタイマー = 最長の172800秒（48時間）', rowOf(rows, 'matingCooldownMinSec'), 172800);
  eq('交配CDの表示の最短側 = 64800秒（18時間）', rows.find((x) => x.field === 'matingCooldownMinSec').rangeMinSec, 64800);
  eq('交配CD（最長） = 172800秒（48時間）', matingCooldownMax(rex, r, null), 172800);
  const measured = timersFor(rex, r, { matingCooldownMinSec: 90000 });
  eq('実測値を入れたらそれで鳴らす', rowOf(measured, 'matingCooldownMinSec'), 90000);
  eq('インプリント間隔 = 28800秒（8時間）', rowOf(rows, 'cuddle'), CUDDLE_BASE_SEC);
}

console.log('\n「速度」系の倍率は時間を割る（値を上げると短くなる）');
{
  const rows = timersFor(rex, normalizeRates({ eggHatchSpeed: 10, babyMatureSpeed: 20 }), null);
  eq('孵化速度10x → 1799.856秒（29:59）', rowOf(rows, 'incubationSec'), 1799.856);
  eq('成長速度20x → 16666.67秒（4:37:47）', rowOf(rows, 'maturationSec'), 16666.67);
}

console.log('\n「間隔」系の倍率は時間を掛ける（値を下げると短くなる）');
{
  const r = normalizeRates({ matingInterval: 0.5, cuddleInterval: 0.25 });
  const rows = timersFor(rex, r, null);
  eq('交配間隔0.5x → 最長側 86400秒（24時間）', rowOf(rows, 'matingCooldownMinSec'), 86400);
  eq('インプリント間隔0.25x → 7200秒（2時間）', rowOf(rows, 'cuddle'), 7200);
}

console.log('\nデータが無い生物（ASA新規）');
{
  const lumina = { key: 'lumina', name: 'Lumina', breedable: true, breeding: null };
  const r = normalizeRates({ eggHatchSpeed: 10 });
  const rows = timersFor(lumina, r, null);
  eq('孵化は null（0ではない）', rowOf(rows, 'incubationSec') === null ? 1 : 0, 1);
  eq('成体までも null', rowOf(rows, 'maturationSec') === null ? 1 : 0, 1);
  // インプリント間隔は cuddleInterval だけに依存するので、孵化速度を上げても8時間のまま
  eq('インプリント間隔はデータ無しでも出せる', rowOf(rows, 'cuddle'), 28800);

  // 実測「1時間30分」を入れる → 1x基準は 5400 × 10 = 54000秒 として保存される
  const base = applyRate(5400, 10, 'speed') === 540 ? 5400 * 10 : null;
  eq('実測5400秒を1x基準に直すと54000秒', base, 54000);
  const withOverride = timersFor(lumina, r, { incubationSec: 54000 });
  eq('保存後、同じ倍率なら5400秒に戻る', rowOf(withOverride, 'incubationSec'), 5400);
  const halved = timersFor(lumina, normalizeRates({ eggHatchSpeed: 5 }), { incubationSec: 54000 });
  eq('倍率を10x→5xにすると10800秒に伸びる', rowOf(halved, 'incubationSec'), 10800);
}

console.log('\n不正な倍率は 1 として扱う');
{
  const rows = timersFor(rex, normalizeRates({ eggHatchSpeed: 0, babyMatureSpeed: -3 }), null);
  eq('0 は無視', rowOf(rows, 'incubationSec'), 17998.56);
  eq('負値は無視', rowOf(rows, 'maturationSec'), 333333.31);
}

console.log(failed ? `\n${failed}件 失敗しました` : '\nすべて通りました');
process.exit(failed ? 1 : 0);
