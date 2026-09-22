// アイテムの検索と共通文字列の自己チェック。
//
// 共通文字列はゲーム内の検索欄に打つためのものなので、「一番絞り込める候補が先頭に来ること」と
// 「同じ件数しか拾えない短い候補を出さないこと」が要になる。
//
//   node tools/test-items.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  searchItems,
  commonStrings,
  countMatches,
  qualityString,
  qualityVariants,
  QUALITIES,
} from '../src/data/items.js';

const items = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'data', 'items.json'), 'utf8'),
);
const allNames = items.map((i) => i.name);

let failed = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? '  OK ' : '  NG '} ${label}: ${JSON.stringify(actual)}${ok ? '' : `（期待 ${JSON.stringify(expected)}）`}`);
};

// 件数を数える相手を固定して、候補の並びだけを見る
const FIXTURE = [
  'Raw Meat', 'Raw Prime Meat', 'Raw Mutton', 'Raw Fish Meat',
  'Cooked Meat', 'Cooked Prime Meat', 'Wood', 'Fiber',
];
const top = (selected, n = 3) =>
  commonStrings(selected, FIXTURE, { limit: n }).map((c) => [c.text, c.hits]);

console.log('共通文字列 — 絞り込める順に出る');
{
  // FIXTURE には Raw で始まる名前が4件ある。'Raw' は 'Raw ' と同じ4件なので間引かれる
  eq('Raw 3種', top(['Raw Meat', 'Raw Prime Meat', 'Raw Mutton']), [['Raw ', 4], [' M', 6]]);
  eq('1件だけ選ぶと名前そのもの', top(['Raw Mutton'], 1), [['Raw Mutton', 1]]);
  eq('共通部分が無ければ空', commonStrings(['Wood', 'Fiber'], FIXTURE), []);
  eq('min より短い共通部分は出さない', commonStrings(['Wood', 'Cooked Meat'], FIXTURE, { min: 3 }), []);
  eq('既定の min は2文字', commonStrings(['Wood', 'Cooked Meat'], FIXTURE).map((c) => c.text), ['oo']);
  eq('選択が空なら空', commonStrings([], FIXTURE), []);
}

console.log('\n短い候補の間引き');
{
  const list = commonStrings(['Raw Meat', 'Raw Prime Meat'], FIXTURE, { limit: 20 });
  // 「より長い候補に含まれていて件数も同じ」ものが残っていないこと
  const bad = list.filter((c, i) =>
    list.some((o, j) => j !== i && o.hits === c.hits && o.text.length > c.text.length
      && o.text.toLowerCase().includes(c.text.toLowerCase())),
  );
  eq('同じ件数しか拾えない短い候補は無い', bad.map((c) => c.text), []);
  eq('先頭が一番絞り込める', list[0].hits, Math.min(...list.map((c) => c.hits)));
}

console.log('\n大文字小文字は問わない');
{
  // 返す文字列は、一番短い名前の書き方をそのまま使う
  eq('小文字で選んでも当たる', top(['raw meat', 'RAW MUTTON'], 1), [['raw m', 2]]);
  eq('件数も大小を無視して数える', countMatches(FIXTURE, 'RAW '), countMatches(FIXTURE, 'raw '));
}

console.log('\n実データ');
{
  // 共通文字列は英名から作る（ゲーム内の英語表記に貼るため）
  const real = commonStrings(['Raw Meat', 'Raw Prime Meat', 'Raw Mutton'], allNames, { limit: 1 });
  eq('Raw 3種の先頭候補', [real[0].text, real[0].hits], ['Raw ', 9]);
  eq('Kibble を含むアイテム', countMatches(allNames, 'Kibble'), 48);
  eq('日本語名から英名を引ける', searchItems(items, '生肉', { limit: 1 })[0].name, 'Raw Meat');
  eq('キブルも日本語で引ける', searchItems(items, 'キブル(超級)', { limit: 1 })[0].name, 'Exceptional Kibble');
  const kibble = commonStrings(['Basic Kibble', 'Superior Kibble', 'Exceptional Kibble'], allNames, { limit: 1 });
  eq('キブル3種の先頭候補', [kibble[0].text, kibble[0].hits], [' Kibble', 7]);
}

console.log('\n除外したものに当たる候補は出さない');
{
  const ex = (sel, exclude, n = 3) =>
    commonStrings(sel, FIXTURE, { limit: n, exclude }).map((c) => c.text);
  // 腐肉は拾いたいが生肉は拾いたくない、という使い方
  const meats = ['Spoiled Meat', 'Raw Meat', 'Raw Prime Meat', 'Raw Mutton', 'Cooked Meat'];
  eq('除外なしだと " Meat" が出る', commonStrings(['Spoiled Meat'], meats, { limit: 20 }).map((c) => c.text).includes(' Meat'), true);
  eq('生肉を除外すると " Meat" は消える',
    commonStrings(['Spoiled Meat'], meats, { limit: 20, exclude: ['Raw Meat'] }).map((c) => c.text).includes(' Meat'), false);
  eq('残る候補は生肉に当たらない',
    commonStrings(['Spoiled Meat'], meats, { limit: 20, exclude: ['Raw Meat'] })
      .every((c) => !'raw meat'.includes(c.text.toLowerCase())), true);
  // 分けようがない組み合わせでは空になる
  eq('分けられないときは空', ex(['Raw Meat', 'Raw Prime Meat'], ['Raw Mutton', 'Raw Fish Meat']), []);
  eq('除外が空なら今までどおり', ex(['Raw Meat', 'Raw Prime Meat'], [], 1), ['Raw ']);
  eq('除外が未指定でも落ちない', commonStrings(['Raw Meat'], FIXTURE, { limit: 1 }).length, 1);
}

console.log('\n短い順（画面はこれを1件だけ出す）');
{
  // 実データで見る（固定の数件だと、短い候補が「同じ件数の重複」として間引かれてしまう）
  const shortest = (sel, exclude) =>
    commonStrings(sel, allNames, { limit: 1, order: 'length', exclude })[0]?.text ?? null;
  eq('短いものが先に来る', shortest(['Raw Meat', 'Raw Prime Meat']), 'aw');
  // 非対象を指定すると、そこに当たる短い候補は消え、残った中で一番短いものになる
  eq('非対象を避けた一番短いもの', shortest(['Raw Prime Meat'], ['Raw Meat', 'Raw Mutton']), 'Pr');
  eq('分けられないときは null', shortest(['Raw Meat', 'Raw Prime Meat'], ['Raw Mutton', 'Raw Fish Meat']), null);
  // 既定の並び（一致件数の少ない順）は変わっていない
  eq('既定は絞り込める順のまま', commonStrings(['Raw Meat', 'Raw Prime Meat'], FIXTURE, { limit: 1 })[0].text, 'Raw ');
}

console.log('\n品質で絞るとき');
{
  const plan = (sel, exclude, quality) => qualityString(sel, allNames, { quality, exclude });
  const text = (...a) => plan(...a)?.text ?? null;

  eq('品質は6段', QUALITIES.length, 6);
  eq('取りうる名前は品質なし＋6段', qualityVariants('Gacha Crystal').length, 7);
  eq('品質なしも候補に入る', qualityVariants('Gacha Crystal')[0], 'Gacha Crystal');

  // 他の品質のガチャ・クリスタルに当たってはいけないので、Cr だけでは足りない
  const only = text(['Gacha Crystal'], [], 'Ascendant');
  eq('他の品質に当たらない', QUALITIES.filter((q) => q !== 'Ascendant').every((q) => !`${q} Gacha Crystal`.includes(only)), true);
  eq('品質なしにも当たらない', 'Gacha Crystal'.includes(only), false);
  eq('その品質の名前には当たる', 'Ascendant Gacha Crystal'.includes(only), true);

  // 非対象を足すと、そこに当たる候補は避ける（品質が違っても避ける）
  const sharp = text(['Gacha Crystal'], ['Gacha Saddle'], 'Ascendant');
  eq('非対象を避けた文字列', sharp, 'nt Gacha C');
  eq('非対象の全品質に当たらない', QUALITIES.every((q) => !`${q} Gacha Saddle`.includes(sharp)), true);
  eq('対象には当たる', 'Ascendant Gacha Crystal'.includes(sharp), true);
  eq('品質を変えれば文字列も変わる', text(['Gacha Crystal'], ['Gacha Saddle'], 'Mastercraft'), 'ft Gacha C');

  // 名前の先頭から始まる必要はない（Ascendant Gacha C のような長い前置きを出さない）
  eq('必要以上に長くならない', sharp.length < 'Ascendant Gacha C'.length, true);
  eq('件数はゲーム内に並びうる名前で数える', plan(['Gacha Crystal'], ['Gacha Saddle'], 'Ascendant').hits, countMatches(allNames.flatMap((n) => qualityVariants(n)), sharp));
  eq('品質を渡さなければ何も出ない', qualityString(['Gacha Crystal'], allNames, { quality: '' }), null);
  eq('対象が無ければ何も出ない', qualityString([], allNames, { quality: 'Ascendant' }), null);
}

console.log('\n日本語名でも引ける');
{
  const ja = [
    { key: 'rawmeat', name: 'Raw Meat', nameJa: '生肉', category: 'Meat' },
    { key: 'cookedmeat', name: 'Cooked Meat', nameJa: 'こんがり肉', category: 'Meat' },
    { key: 'narcotic', name: 'Narcotic', nameJa: '麻酔薬', category: 'Consumables' },
    { key: 'stone', name: 'Stone', nameJa: '石', category: 'Resources' },
  ];
  const names = (q) => searchItems(ja, q, { limit: 4 }).map((i) => i.name);
  eq('日本語名の完全一致', names('生肉'), ['Raw Meat']);
  eq('日本語名の部分一致', names('肉'), ['Cooked Meat', 'Raw Meat']);
  eq('平仮名でも当たる', names('こんがり'), ['Cooked Meat']);
  eq('英名でも変わらず引ける', names('narcotic'), ['Narcotic']);
  eq('日本語名が無くても落ちない', searchItems([{ key: 'x', name: 'Wood' }], 'wood').length, 1);
}

console.log('\n検索');
{
  eq('完全一致が先頭', searchItems(items, 'Raw Meat', { limit: 1 })[0].name, 'Raw Meat');
  eq('前方一致は名前順', searchItems(items, 'narco', { limit: 2 }).map((i) => i.name), ['Narcoberry', 'Narcoberry Seed']);
  eq('件数の上限が効く', searchItems(items, 'saddle', { limit: 5 }).length, 5);
  eq('空の検索語でも落ちない', searchItems(items, '', { limit: 3 }).length, 3);
  eq('当たらない語は空', searchItems(items, 'ぬるぽ', { limit: 5 }), []);
}

console.log(failed ? `\n${failed}件 失敗しました` : '\nすべて通りました');
process.exit(failed ? 1 : 0);
