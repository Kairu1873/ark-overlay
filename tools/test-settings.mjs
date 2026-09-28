// 設定の値の扱いの自己チェック。
//
//   node tools/test-settings.mjs

import {
  normalizeAppearance,
  toAccelerator,
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

console.log('\nショートカットの表記');
{
  const k = (code, mods = '') => ({
    code,
    ctrlKey: mods.includes('c'),
    altKey: mods.includes('a'),
    shiftKey: mods.includes('s'),
    metaKey: mods.includes('m'),
  });
  eq('Alt+Shift+英字', toAccelerator(k('KeyX', 'as')), 'Alt+Shift+X');
  eq('修飾キーは Ctrl, Alt, Shift, Super の順', toAccelerator(k('KeyT', 'msac')), 'Ctrl+Alt+Shift+Super+T');
  eq('数字', toAccelerator(k('Digit1', 'c')), 'Ctrl+1');
  eq('テンキー', toAccelerator(k('Numpad5', 'a')), 'Alt+num5');
  eq('F キー', toAccelerator(k('F12', 'c')), 'Ctrl+F12');
  eq('移動系', toAccelerator(k('ArrowUp', 'a')), 'Alt+Up');
  eq('修飾キーなしは受けない', toAccelerator(k('KeyX')), null);
  eq('Shift だけでは受けない', toAccelerator(k('KeyX', 's')), null);
  eq('修飾キーだけでは受けない', toAccelerator(k('AltLeft', 'a')), null);
  eq('記号キーは受けない（配列で刻印がずれる）', toAccelerator(k('Semicolon', 'c')), null);
  eq('F25 は無い', toAccelerator(k('F25', 'c')), null);
}

console.log(failed ? `\n${failed}件 失敗しました` : '\nすべて通りました');
process.exit(failed ? 1 : 0);
