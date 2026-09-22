// レベルを振ったときのステータス。
//
// 式は ARK Smart Breeding（StatValueCalculation）と同じ。
//   野生の値 = 基礎値 × (1 + 野生1レベルの伸び × そのステータスに振られたレベル数)
//
// 1匹の生物はレベルを各ステータスに散らして振るため、「レベル150の体力」は一意に決まらない。
// ここで出すのは「そのステータスに n レベル振った場合の値」である。

/** 図鑑に出すステータスの順番と表示名 */
export const STAT_LABELS = [
  ['health', '体力'],
  ['stamina', 'スタミナ'],
  ['oxygen', '酸素'],
  ['food', '食料'],
  ['weight', '重量'],
  ['damage', '近接攻撃'],
  ['speed', '移動速度'],
  ['torpor', '気絶値'],
];

/** 近接攻撃と移動速度は % で持っている */
export const PERCENT_STATS = new Set(['damage', 'speed']);

const finite = (v) => (Number.isFinite(v) ? v : null);

/**
 * そのステータスに野生レベルを振ったときの値。
 * Smart Breeding の値（statsRaw）があればそれを使い、無ければ基礎値と成長率から出す。
 * @returns {number|null} レベルを振れないステータス（伸びが無い）は基礎値をそのまま返す
 */
export function wildStatAt(creature, key, levels = 0) {
  const lv = Number.isFinite(levels) && levels > 0 ? Math.floor(levels) : 0;
  const raw = creature?.statsRaw?.[key] ?? null;
  const base = finite(raw?.base) ?? finite(creature?.stats?.[key]);
  if (base === null) return null;

  if (raw && Number.isFinite(raw.incWild)) {
    const value = base * (1 + raw.incWild * lv);
    return PERCENT_STATS.has(key) ? value * 100 : value;
  }
  // statsRaw が無い生物は、日本語Wiki由来の「1レベルあたりの増分」で代用する
  const per = finite(creature?.growth?.wild?.[key]) ?? 0;
  return base + per * lv;
}

/** 1レベルあたりの増分（表示用）。statsRaw があればそこから出す */
export function wildGainPerLevel(creature, key) {
  const raw = creature?.statsRaw?.[key] ?? null;
  if (raw && Number.isFinite(raw.base) && Number.isFinite(raw.incWild)) {
    const gain = raw.base * raw.incWild;
    return PERCENT_STATS.has(key) ? gain * 100 : gain;
  }
  return finite(creature?.growth?.wild?.[key]);
}

/** 表示用に丸める。小数が出るのは近接攻撃の伸びなどごく一部 */
export const roundStat = (v) => (v === null ? null : Math.round(v * 100) / 100);
