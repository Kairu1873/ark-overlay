// テイムに必要な餌の数・時間・麻酔を出す。
//
// 式は英語Wikiの Module:TamingTable と同じものを使っている。Wiki が公開している表と
// 値が一致することを Rex で固定してある（tools/test-taming.mjs）。
// 係数を持たない生物（ASA新規の多く）は空の結果を返す。呼び出し側で「データなし」を出すこと。

/** 気絶値を戻す手段。torpor=1個あたりの回復量 / seconds=効いている秒数 */
export const NARCOTIC_DEFS = [
  { key: 'berry', label: 'ナルコベリー', torpor: 7.5, seconds: 3 },
  { key: 'narcotic', label: '麻酔薬', torpor: 40, seconds: 8 },
  { key: 'bioToxin', label: 'バイオトキシン', torpor: 80, seconds: 16 },
];

export const DEFAULT_TAMING_LEVEL = 150;

// 2020年8月に入った x4 テイム。usesCustomAffinityLogic の生物には掛からない
const AFFINITY_X4 = 4;

const positive = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 1);

/**
 * 気絶値が減る速さ（毎秒）。
 * Wiki の指数近似をそのまま使う（出典: crumplecorn のテイム計算機）。
 */
export function torporDepletionPerSec(ps0, level) {
  if (!Number.isFinite(ps0) || ps0 <= 0) return 0;
  if (level <= 1) return ps0;
  return ps0 + Math.exp(0.800403041 * Math.log(level - 1)) / (22.39671632 / ps0);
}

/**
 * 餌ごとのテイム計画を出す。
 * @param {object} creature data/creatures.json の1件
 * @param {object} foodTable data/taming-food.json
 * @param {{level?: number, rates?: object}} opt rates は normalizeRates() の結果
 * @returns {{level:number, method:string|null, affinityNeeded:number|null,
 *            totalTorpor:number|null, torporPerSec:number,
 *            rows:{food:string, pieces:number, seconds:number, feedingInterval:number|null,
 *                  torporNeeded:number|null, narcotics:object|null, favorite:boolean}[]}}
 */
export function tamingPlan(creature, foodTable, { level = DEFAULT_TAMING_LEVEL, rates } = {}) {
  const t = creature?.taming ?? null;
  const lv = Math.max(1, Math.floor(Number(level) || DEFAULT_TAMING_LEVEL));
  const empty = {
    level: lv,
    method: t?.method ?? null,
    affinityNeeded: null,
    totalTorpor: null,
    torporPerSec: 0,
    rows: [],
  };
  if (!t || !Number.isFinite(t.affinityBase) || !Number.isFinite(t.affinityPerLevel)) return empty;
  if (!Array.isArray(t.eats) || !t.eats.length) return empty;

  const tamingSpeed = positive(rates?.tamingSpeed);
  const foodDrain = positive(rates?.foodDrain);
  const passive = t.method === 'passive';
  // 平和テイムのときだけ効く倍率
  const wakeAffinityMult = passive ? (t.wakeAffinityMult ?? 1) : 1;
  const wakeFoodDeplMult = passive ? (t.wakeFoodDeplMult ?? 1) : 1;

  // 注意: レベルに掛けるのは level であって level-1 ではない（Wiki の式どおり）
  const affinityNeeded = t.affinityBase + t.affinityPerLevel * lv;
  const totalTorpor = Number.isFinite(t.torpor1)
    ? t.torpor1 + (t.torporIncrease ?? 0) * (lv - 1)
    : null;
  const torporPerSec = torporDepletionPerSec(t.torporDepletionPS0, lv);
  const foodRate = t.foodConsumptionBase * t.foodConsumptionMult * foodDrain;

  const rows = [];
  for (const food of t.eats) {
    // Primitive Plus は ASA に無いモードなので出さない（英語Wikiの表には残っている）
    if (food.includes('(Primitive Plus)')) continue;
    const special = t.specialFoodValues?.[food] ?? null;
    const base = foodTable?.[food] ?? null;
    let affinity = special?.affinity ?? base?.affinity ?? 0;
    let value = special?.value ?? base?.foodValue ?? 0;
    if (!t.usesCustomAffinityLogic) affinity = affinity * wakeAffinityMult * AFFINITY_X4;
    value *= wakeFoodDeplMult;
    affinity *= tamingSpeed;
    // 値の無い餌は Wiki 側でも行を出していない
    if (!(affinity > 0) || !(value > 0) || !(foodRate > 0)) continue;

    const pieces = Math.ceil(affinityNeeded / affinity);
    let seconds = Number.isFinite(t.constantFeedingInterval)
      ? t.constantFeedingInterval * pieces
      : Math.ceil((pieces * value) / foodRate);
    // Basilosaurus だけ Wiki 側に補正が入っている。端数は Wiki と同じく切り捨てる
    if (Number.isFinite(t.resultCorrection)) seconds = Math.floor(seconds * t.resultCorrection);

    const torporNeeded =
      totalTorpor === null || passive
        ? null
        : Math.max(0, Math.ceil(torporPerSec * seconds - totalTorpor));
    const narcotics =
      torporNeeded === null || torporPerSec <= 0
        ? null
        : Object.fromEntries(
            NARCOTIC_DEFS.map((d) => [d.key, Math.ceil(torporNeeded / (d.torpor + d.seconds * torporPerSec))]),
          );
    // 最後の1個で完了するので、間隔は個数-1で割る
    const feedingInterval = !passive || pieces <= 1
      ? null
      : t.constantFeedingInterval ?? seconds / (pieces - 1);

    rows.push({
      food,
      pieces,
      seconds,
      feedingInterval,
      torporNeeded,
      narcotics,
      favorite: food === 'Kibble' || food === t.favoriteFood,
    });
  }

  return { level: lv, method: t.method ?? null, affinityNeeded, totalTorpor, torporPerSec, rows };
}
