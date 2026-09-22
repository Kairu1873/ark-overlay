// サーバー倍率。ARK の設定名にそのまま対応させる。
//
// 注意: 倍率の効く向きが設定ごとに違う。
//   EggHatchSpeedMultiplier / BabyMatureSpeedMultiplier … 「速度」なので 時間 ÷ 倍率
//   MatingIntervalMultiplier / BabyCuddleIntervalMultiplier … 「間隔」なので 時間 × 倍率
// （ark.wiki.gg の Server configuration の記述で確認済み）
//
// kind: 'taming' のものはタイマーには効かない。餌1個あたりの affinity と食料の減りに効くため、
// 時間への掛け算では表せない。applyRate() は通さず taming.js の中で直接使う。

export const RATE_DEFS = [
  { key: 'eggHatchSpeed', label: '孵化・妊娠の速度', setting: 'EggHatchSpeedMultiplier', kind: 'speed' },
  { key: 'babyMatureSpeed', label: '成長の速度', setting: 'BabyMatureSpeedMultiplier', kind: 'speed' },
  { key: 'matingInterval', label: '交配の間隔', setting: 'MatingIntervalMultiplier', kind: 'interval' },
  { key: 'cuddleInterval', label: 'インプリントの間隔', setting: 'BabyCuddleIntervalMultiplier', kind: 'interval' },
  // 下の2つはタイマーではなくテイム計算で使う（src/data/taming.js）
  { key: 'tamingSpeed', label: 'テイムの速度', setting: 'TamingSpeedMultiplier', kind: 'taming' },
  { key: 'foodDrain', label: '食料の減る速さ', setting: 'DinoCharacterFoodDrainMultiplier', kind: 'taming' },
  { key: 'wildFoodDrain', label: '野生の食料の減る速さ', setting: 'WildDinoCharacterFoodDrainMultiplier', kind: 'taming' },
  { key: 'wildTorporDrain', label: '野生の気絶値の減る速さ', setting: 'WildDinoTorporDrainMultiplier', kind: 'taming' },
];

export const DEFAULT_RATES = Object.fromEntries(RATE_DEFS.map((d) => [d.key, 1]));

/** 保存値を既定値で埋めつつ、正の数だけ通す */
export function normalizeRates(saved) {
  const out = { ...DEFAULT_RATES };
  for (const def of RATE_DEFS) {
    const v = Number(saved?.[def.key]);
    if (Number.isFinite(v) && v > 0) out[def.key] = v;
  }
  return out;
}

/** 1x基準の秒数に倍率を適用する */
export function applyRate(baseSec, rate, kind) {
  if (baseSec === null || baseSec === undefined) return null;
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return kind === 'speed' ? baseSec / r : baseSec * r;
}
