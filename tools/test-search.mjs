// 生物検索の自己チェック。
// 日本語名は表記の揺れ（平仮名・半角カナ・長音・中黒）で当たり外れが起きやすいので、
// 代表的な入力を固定しておく。
//
//   node tools/test-search.mjs

import { searchIn } from '../src/data/store.js';

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? '  OK ' : '  NG '} ${label}: ${actual} ${ok ? '' : `（期待 ${expected}）`}`);
};

// 検索の性質だけを見たいので、実データではなく固定の数件で試す
const list = [
  { key: 'rex', name: 'Rex', nameJa: 'ティラノサウルス', group: 'Dinosaurs', breedable: true, tameable: true },
  { key: 'raptor', name: 'Raptor', nameJa: 'ラプトル', group: 'Dinosaurs', breedable: true, tameable: true },
  { key: 'argentavis', name: 'Argentavis', nameJa: 'アルゲンタヴィス', group: 'Birds', breedable: true, tameable: true },
  { key: 'sabertoothsalmon', name: 'Sabertooth Salmon', nameJa: 'セイバートゥース・サーモン', group: 'Fish', breedable: false, tameable: false },
  { key: 'lumina', name: 'Lumina', nameJa: null, group: null, breedable: true, tameable: true },
];
const top = (q, opt) => searchIn(list, q, opt)[0]?.key ?? null;
const hits = (q) => searchIn(list, q).map((c) => c.key).join(',');

console.log('英名で引く');
{
  eq('完全一致', top('Rex'), 'rex');
  eq('大文字小文字は問わない', top('rex'), 'rex');
  eq('前方一致', top('Argen'), 'argentavis');
  eq('日本語名が無くても引ける', top('Lumina'), 'lumina');
}

console.log('\n日本語名で引く');
{
  eq('片仮名の前方一致', top('ティラノ'), 'rex');
  eq('平仮名でも当たる', top('てぃらの'), 'rex');
  eq('半角カナでも当たる', top('ﾃｨﾗﾉ'), 'rex');
  eq('全角英数でも当たる', top('Ｒｅｘ'), 'rex');
  eq('部分一致', top('サウルス'), 'rex');
  eq('中黒を省いても当たる', top('セイバートゥースサーモン'), 'sabertoothsalmon');
  eq('長音を省いても当たる', top('セイバトゥス'), 'sabertoothsalmon');
}

console.log('\n順位と絞り込み');
{
  eq('完全一致が前方一致より先', top('ラプトル'), 'raptor');
  eq('グループ名でも拾える', hits('Birds'), 'argentavis');
  eq('当たらない語は空', hits('ぬるぽ'), '');
  eq('繁殖できるものだけに絞れる', searchIn(list, '', { breedableOnly: true }).length, 4);
  eq('テイムできるものだけに絞れる', searchIn(list, '', { tameableOnly: true }).length, 4);
  eq('空の検索語では全件返す', searchIn(list, '', { limit: Infinity }).length, 5);
}

console.log(failed ? `\n${failed}件 失敗しました` : '\nすべて通りました');
process.exit(failed ? 1 : 0);
