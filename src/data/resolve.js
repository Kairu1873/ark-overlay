// 生物ごとに「何のタイマーが作れるか」を出す。
//
// Wiki に値が無いものは null のまま返す。呼び出し側で「データなし」を出して、
// 利用者が入力した値（overrides）で埋められるようにする。
// 黙って 0 を返すとタイマーが即発火するので、欠損は必ず null で表すこと。

import { applyRate } from './rates.js';

/** インプリント要求の既定間隔（8時間）。MOD生物以外は一律この値 */
export const CUDDLE_BASE_SEC = 28800;

const pick = (breeding, override, field) => {
  const o = Number(override?.[field]);
  if (Number.isFinite(o) && o > 0) return { sec: o, manual: true };
  const w = breeding?.[field];
  return Number.isFinite(w) && w > 0 ? { sec: w, manual: false } : { sec: null, manual: false };
};

/**
 * 生物から作れるタイマーの一覧を返す。
 * @param {object} creature data/creatures.json の1件
 * @param {object} rates normalizeRates() の結果
 * @param {object} [override] 利用者が入力した秒数
 * @returns {{field:string,label:string,name:string,baseSec:number|null,seconds:number|null,manual:boolean}[]}
 */
export function timersFor(creature, rates, override) {
  const b = creature?.breeding ?? null;
  const rows = [];

  const add = (field, label, kind, rateKey) => {
    const { sec, manual } = pick(b, override, field);
    rows.push({
      field,
      label,
      name: `${creature.name} ${label}`,
      baseSec: sec,
      seconds: sec === null ? null : applyRate(sec, rates[rateKey], kind),
      manual,
    });
  };

  // 卵生か胎生かで出す行を変える。両方欠けている場合は孵化の行だけ出して入力を促す
  const hasGestation = pick(b, override, 'gestationSec').sec !== null;
  if (hasGestation) add('gestationSec', '妊娠', 'speed', 'eggHatchSpeed');
  else add('incubationSec', '孵化', 'speed', 'eggHatchSpeed');

  add('maturationSec', '成体まで', 'speed', 'babyMatureSpeed');
  addMatingCooldown(rows, creature, b, rates, override);

  // インプリント間隔は生物に依らない（MOD生物以外は一律8時間）。
  // Wiki にデータが無い ASA 新規生物でも必ず出せる
  rows.push({
    field: 'cuddle',
    label: 'インプリント間隔',
    name: `${creature.name} インプリント`,
    baseSec: CUDDLE_BASE_SEC,
    seconds: applyRate(CUDDLE_BASE_SEC, rates.cuddleInterval, 'interval'),
    manual: false,
  });

  return rows;
}

/**
 * 交配クールダウンの行。ゲーム内の値は最短〜最長の幅を持ち、どこに落ちるかは分からない。
 * タイマーは確実に明けている最長側で鳴らし、最短側は表示用に rangeMinSec で渡す。
 * 利用者が実測値を入れていれば、それをそのまま使う。
 */
function addMatingCooldown(rows, creature, b, rates, override) {
  const field = 'matingCooldownMinSec';
  const min = pick(b, override, field);
  const max = pick(b, null, 'matingCooldownMaxSec');
  const useMax = !min.manual && max.sec !== null;
  const sec = useMax ? max.sec : min.sec;
  const scale = (v) => (v === null ? null : applyRate(v, rates.matingInterval, 'interval'));
  const label = '交配クールダウン';
  rows.push({
    field,
    label,
    name: `${creature.name} ${label}`,
    baseSec: sec,
    seconds: scale(sec),
    rangeMinSec: useMax && min.sec !== null && min.sec !== max.sec ? scale(min.sec) : null,
    manual: min.manual,
  });
}

/** 交配クールダウンの最長側（表示の補足に使う） */
export function matingCooldownMax(creature, rates, override) {
  const { sec } = pick(creature?.breeding ?? null, override, 'matingCooldownMaxSec');
  return sec === null ? null : applyRate(sec, rates.matingInterval, 'interval');
}

/** 生物がどれだけデータを持っているか（一覧のバッジ用） */
export function coverageOf(creature, override) {
  const fields = ['incubationSec', 'gestationSec', 'maturationSec'];
  const have = fields.filter((f) => pick(creature?.breeding ?? null, override, f).sec !== null);
  if (!creature.breedable) return 'n/a';
  return have.length ? 'ok' : 'missing';
}
