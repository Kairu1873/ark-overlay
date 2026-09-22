// テイムに必要な餌の数・時間・麻酔を出す。
//
// 式は英語Wikiの Module:TamingTable と同じものを使っている。Wiki が公開している表と
// 値が一致することを Rex で固定してある（tools/test-taming.mjs）。
// 係数を持たない生物（ASA新規の多く）は空の結果を返す。呼び出し側で「データなし」を出すこと。

/** 気絶値を戻す手段。torpor=1個あたりの回復量 / seconds=効いている秒数 */
export const NARCOTIC_DEFS = [
  { key: 'berry', label: 'ナルコベリー', torpor: 7.5, seconds: 3 },
  { key: 'ascerbic', label: '麻酔キノコ', torpor: 25, seconds: 3 },
  { key: 'narcotic', label: '麻酔薬', torpor: 40, seconds: 8 },
  { key: 'bioToxin', label: 'バイオトキシン', torpor: 80, seconds: 16 },
];

/** Sanguine Elixir を使うと必要 affinity が 3割減る */
export const SANGUINE_ELIXIR_FACTOR = 0.7;

export const DEFAULT_TAMING_LEVEL = 150;

// 2020年8月に入った x4 テイム。usesCustomAffinityLogic の生物には掛からない
const AFFINITY_X4 = 4;

const positive = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 1);

/**
 * 気絶値が減る速さ（毎秒）。
 * Wiki の指数近似をそのまま使う（出典: crumplecorn のテイム計算機）。
 */
export function torporDepletionPerSec(ps0, level, wildTorporDrain = 1) {
  if (!Number.isFinite(ps0) || ps0 <= 0) return 0;
  const base = level <= 1 ? ps0 : ps0 + Math.exp(0.800403041 * Math.log(level - 1)) / (22.39671632 / ps0);
  return base * (Number.isFinite(wildTorporDrain) && wildTorporDrain > 0 ? wildTorporDrain : 1);
}

/**
 * 餌ごとのテイム計画を出す。
 * @param {object} creature data/creatures.json の1件
 * @param {object} foodTable data/taming-food.json
 * @param {{level?: number, rates?: object, sanguineElixir?: boolean}} opt rates は normalizeRates() の結果
 * @returns {{level:number, method:string|null, affinityNeeded:number|null,
 *            totalTorpor:number|null, torporPerSec:number,
 *            rows:{food:string, pieces:number, seconds:number, feedingInterval:number|null,
 *                  torporNeeded:number|null, narcotics:object|null, favorite:boolean,
 *                  effectiveness:number, bonusLevel:number}[]}}
 */
export function tamingPlan(
  creature,
  foodTable,
  { level = DEFAULT_TAMING_LEVEL, rates, sanguineElixir = false } = {},
) {
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
  // 食料の減りは「全生物」と「野生のみ」の2つの倍率が掛かる
  const foodDrain = positive(rates?.foodDrain) * positive(rates?.wildFoodDrain);
  const passive = t.method === 'passive';
  // 平和テイムのときだけ効く倍率
  const wakeAffinityMult = passive ? (t.wakeAffinityMult ?? 1) : 1;
  const wakeFoodDeplMult = passive ? (t.wakeFoodDeplMult ?? 1) : 1;

  // 注意: レベルに掛けるのは level であって level-1 ではない（Wiki の式どおり）
  const affinityNeeded =
    (t.affinityBase + t.affinityPerLevel * lv) * (sanguineElixir ? SANGUINE_ELIXIR_FACTOR : 1);
  const totalTorpor = Number.isFinite(t.torpor1)
    ? t.torpor1 + (t.torporIncrease ?? 0) * (lv - 1)
    : null;
  const torporPerSec = torporDepletionPerSec(t.torporDepletionPS0, lv, positive(rates?.wildTorporDrain));
  const foodRate = t.foodConsumptionBase * t.foodConsumptionMult * foodDrain;

  const rows = [];
  for (const food of t.eats) {
    // Primitive Plus は ASA に無いモードなので出さない（英語Wikiの表には残っている）
    if (food.includes('(Primitive Plus)')) continue;
    const special = t.specialFoodValues?.[food] ?? null;
    const base = foodTable?.[food] ?? null;
    // 1回に複数個まとめて食べる餌があるので、あれば個数分を1回ぶんとして扱う
    const quantity = Number.isFinite(special?.quantity) && special.quantity > 0 ? special.quantity : 1;
    let affinity = (special?.affinity ?? base?.affinity ?? 0) * quantity;
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

    // テイム効率。ARK Smart Breeding（Taming.cs）の式をそのまま使う。
    // 餌1個あたりの affinity が大きいほど、少ない回数で済んで効率が落ちない
    const effectiveness = Number.isFinite(t.ineffectiveness)
      ? Math.max(0, 1 / (1 + t.ineffectiveness * (pieces / affinity)))
      : null;
    const bonusLevel = effectiveness === null ? null : Math.floor((lv * effectiveness) / 2);

    rows.push({
      food,
      pieces,
      seconds,
      feedingInterval,
      torporNeeded,
      narcotics,
      effectiveness,
      bonusLevel,
      favorite: food === 'Kibble' || food === t.favoriteFood,
    });
  }

  return { level: lv, method: t.method ?? null, affinityNeeded, totalTorpor, torporPerSec, rows };
}
