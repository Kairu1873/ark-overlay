// 設定の値の扱いの自己チェック。
//
//   node tools/test-settings.mjs

import {
  normalizeAppearance,
  backgroundColor,
  TRANSPARENCY_DEFAULT,
  TRANSPARENCY_MIN,
  TRANSPARENCY_MAX,
} from '../src/settings.js';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? '  OK ' : '  NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : `（期待 ${JSON.stringify(expected)}）`}`);
};

console.log('背景の透過率');
{
  eq('保存が無ければ既定', normalizeAppearance(undefined).transparency, TRANSPARENCY_DEFAULT);
  eq('既定はこれまでの黒30%と同じ', backgroundColor(TRANSPARENCY_DEFAULT), 'rgba(0, 0, 0, 0.3)');
  eq('100% で背景なし', backgroundColor(100), 'rgba(0, 0, 0, 0)');
  eq('下限より小さければ丸める', normalizeAppearance({ transparency: 0 }).transparency, TRANSPARENCY_MIN);
  eq('上限より大きければ丸める', normalizeAppearance({ transparency: 150 }).transparency, TRANSPARENCY_MAX);
  eq('文字列でも受ける（スライダーの値）', normalizeAppearance({ transparency: '85' }).transparency, 85);
  eq('壊れた値は既定', normalizeAppearance({ transparency: 'abc' }).transparency, TRANSPARENCY_DEFAULT);
}

console.log(failed ? `\n${failed}件 失敗しました` : '\nすべて通りました');
process.exit(failed ? 1 : 0);
