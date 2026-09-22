// 3つのソースを突き合わせて data/*.json の形に整える。
//
// 数値の優先順位は Dv/data > TamingTable > Cargo。
// 日本語Wikiは定性情報（テイム方法・餌の優先順位）だけを供給し、数値には使わない。
//
// 時間はすべて「サーバー倍率1x基準の秒」に統一する。
// 注意: Cargo の BabyTime は Dv/data の maturationtime のちょうど1/10（幼体期のみ）。
//       取り違えると10倍ずれるので、既定では maturationtime を採る。

/** 突き合わせ用のキー。英名から記号と大小文字を落とす */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const bool = (v) => v === '1' || v === 1 || v === true || v === 'Yes';

/** 中身のある値が一つも無ければ null にする（空オブジェクトを残さない） */
const orNull = (o) => (Object.values(o).some((v) => v !== null && v !== undefined) ? o : null);

/**
 * Dv/data の inherits を解決する。変種（Alpha/Aberrant など）が
 * 親の値を引き継ぐので、親を下敷きにして子で上書きする。
 */
export function resolveInherits(dv) {
  const out = {};
  const seen = new Set();

  const resolve = (key, chain = new Set()) => {
    if (out[key]) return out[key];
    const self = dv[key];
    if (!self) return undefined;
    if (chain.has(key)) {
      seen.add(key);
      return self; // 循環参照。自分の値だけ返して打ち切る
    }
    const parentKey = typeof self.inherits === 'string' ? self.inherits : null;
    if (!parentKey || !dv[parentKey]) return (out[key] = self);
    const parent = resolve(parentKey, new Set(chain).add(key)) ?? {};
    return (out[key] = deepMerge(parent, self));
  };

  for (const key of Object.keys(dv)) resolve(key);
  if (seen.size) console.warn(`  ! inherits が循環しています: ${[...seen].join(', ')}`);
  return out;
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/** ASA に居る生物かどうか。InGames / ReleasedASA は当てにならないので自前で判定する */
export function isAsaTarget(row, dvEntry) {
  if (str(row.InMod)) return false; // MOD生物
  if (row.IsVariant === '1') return false; // 変種（Alpha/Aberrant など）
  return Boolean(str(row.ReleasedASA)) || Boolean(dvEntry);
}

/**
 * 日本語Wikiの数値で欠けている項目だけを埋める。
 * 英語Wikiの値は上書きしない（ゲームファイル由来で人手を介さない分だけ確か）。
 * 両方に値があって食い違う場合は conflicts に記録し、値は英語側を残す。
 */
// 日本語Wikiの秒数は1秒単位に丸められているので、1%以内なら同じ値とみなす
const near = (a, b) => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  if (b === 0) return false;
  return Math.abs(a - b) / b <= 0.01;
};

/** 日本語Wikiから取れる繁殖時間の項目 */
const JA_TIME_FIELDS = ['incubationSec', 'gestationSec', 'maturationSec'];

/**
 * 繁殖時間に日本語Wikiの値を重ねる。
 * ASA への追従は日本語Wikiの方が早いので、両方にあるときは日本語を採る。
 * ただし入れ替わりの疑いがある組（swapped）は英語側を残す。
 * @returns {{value: object, used: string[]}} used = 日本語から採った項目
 */
function applyJaTimes(value, jaTime, { name, conflicts, swapped }) {
  const merged = { ...value };
  const used = [];
  for (const field of JA_TIME_FIELDS) {
    const ja = jaTime?.[field];
    if (!Number.isFinite(ja) || ja <= 0) continue;
    const en = merged[field];
    const hasEn = Number.isFinite(en);
    // 同じ値なら、小数を持っている英語側（ゲームファイル由来）を残す
    if (hasEn && near(en, ja)) continue;
    if (hasEn) {
      conflicts.push({ name, field, en: Math.round(en), ja, adopted: swapped ? 'en' : 'ja' });
      if (swapped) continue;
    }
    merged[field] = ja;
    used.push(field);
  }
  return { value: merged, used };
}

/**
 * 2種の値が入れ替わっている組を探す。
 *
 * 「Aの日本語値＝Bの英語値」かつ「Bの日本語値＝Aの英語値」が同じ項目で成り立つとき、
 * どちらかのWikiが2種を取り違えているとみる（Baryonyx と Basilisk が実際にそうなっている）。
 * 該当した組では日本語側を採らない。
 */
function findSwappedPairs(entries) {
  const list = entries.filter((e) => e.jaTime && e.breeding.value);
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const fields = JA_TIME_FIELDS.filter(
        (f) =>
          near(a.jaTime[f], b.breeding.value[f]) &&
          near(b.jaTime[f], a.breeding.value[f]) &&
          !near(a.jaTime[f], a.breeding.value[f]),
      );
      if (fields.length) pairs.push({ a: a.name, b: b.name, fields });
    }
  }
  return pairs;
}

// 出現マップ。日本語の生息MAP欄は「原種：The Island, …, ValgueroX種：Genesis: Part 1」のように
// 区切りが崩れているため、分割せず既知の名前で走査する。
// 英語Wikiは ASA の新マップ（Astraeos / Lost Colony / Dragontopia）をまだ持っていない。
const MAPS = [
  ['The Island', ['The Island', 'ザ・アイランド', 'アイランド']],
  ['Scorched Earth', ['Scorched Earth', 'スコーチドアース']],
  ['Aberration', ['Aberration', 'アベレーション']],
  ['Extinction', ['Extinction', 'エクスティンクション']],
  ['Genesis: Part 1', ['Genesis: Part 1', 'Genesis: Part1', 'Genesis Part 1', 'ジェネシス1']],
  ['Genesis: Part 2', ['Genesis: Part 2', 'Genesis: Part2', 'Genesis Part 2', 'ジェネシス2']],
  ['Ragnarok', ['Ragnarok', 'ラグナロク']],
  ['Valguero', ['Valguero', 'ヴァルゲロ', 'バルゲロ']],
  ['The Center', ['The Center', 'ザ・センター', 'センター']],
  ['Crystal Isles', ['Crystal Isles', 'クリスタルアイルズ']],
  ['Lost Island', ['Lost Island', 'ロストアイランド']],
  ['Fjordur', ['Fjordur', 'フィヨルド']],
  ['Astraeos', ['Astraeos', 'アストレオス']],
  ['Lost Colony', ['Lost Colony', 'ロストコロニー']],
  ['Dragontopia', ['Dragontopia', 'ドラゴントピア']],
];
const MAP_ORDER = MAPS.map(([canon]) => canon);
// 長い別名から先に消す。「ロストアイランド」を「アイランド」と取り違えないため
const MAP_ALIASES = MAPS.flatMap(([canon, list]) => list.map((alias) => [alias, canon])).sort(
  (a, b) => b[0].length - a[0].length,
);

/** 日本語の生息MAP欄からマップ名を拾う */
function parseJaMaps(text) {
  let rest = str(text) ?? '';
  const found = new Set();
  for (const [alias, canon] of MAP_ALIASES) {
    if (!rest.includes(alias)) continue;
    found.add(canon);
    rest = rest.split(alias).join(' ');
  }
  return found;
}

/** 英語Wikiと日本語Wikiの出現マップを合わせる */
function mergeMaps(enText, jaText) {
  const en = str(enText)?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const ja = parseJaMaps(jaText);
  if (!en.length && !ja.size) return { value: null, source: null };
  const all = new Set([...en, ...ja]);
  const value = MAP_ORDER.filter((m) => all.has(m));
  // 辞書に無い名前（英語Wiki側にしか出てこないもの）も落とさない
  for (const m of all) if (!value.includes(m)) value.push(m);
  const fromJa = [...ja].some((m) => !en.includes(m));
  const source = [en.length && 'cargo', (ja.size && fromJa) && 'ja'].filter(Boolean).join('+') || 'cargo';
  return { value, source };
}

function buildBreeding(dvEntry, row) {
  const b = dvEntry?.breeding;
  if (b && (num(b.incubationtime) ?? num(b.gestationtime) ?? num(b.maturationtime)) !== null) {
    return {
      value: {
        incubationSec: num(b.incubationtime),
        gestationSec: num(b.gestationtime),
        maturationSec: num(b.maturationtime),
        matingCooldownMinSec: num(b.mintimebetweenmating),
        matingCooldownMaxSec: num(b.maxtimebetweenmating),
        egg: str(b.egg),
        eggTempMin: num(b.mintemp),
        eggTempMax: num(b.maxtemp),
      },
      source: 'dv',
    };
  }
  // Dv/data に無い場合だけ Cargo で代用する。
  // BabyTime は幼体期のみの秒数なので、成体までの時間はその10倍にあたる。
  const incubation = num(row.Incubation);
  const gestation = num(row.Gestation);
  const babyTime = num(row.BabyTime);
  if (incubation === null && gestation === null && babyTime === null) {
    // 英語側が空。日本語Wikiだけが供給源になる（ASA新規生物のほとんどがこれ）
    return { value: null, source: null };
  }
  return {
    value: {
      incubationSec: incubation,
      gestationSec: gestation,
      maturationSec: babyTime === null ? null : babyTime * 10,
      matingCooldownMinSec: null,
      matingCooldownMaxSec: null,
      egg: null,
      eggTempMin: num(row.IncubationMin), // 名前に反して温度
      eggTempMax: num(row.IncubationMax),
    },
    source: babyTime === null ? 'cargo' : 'cargo(BabyTime x10)',
  };
}

function buildTaming(dvEntry, tt) {
  const t = dvEntry?.taming;
  const out = {
    method: null,
    affinityBase: num(t?.tameaffinitybase) ?? num(tt?.affinityNeeded0),
    affinityPerLevel: num(t?.tameaffinityperlevel) ?? num(tt?.affinityIncrease),
    torpor1: num(t?.torpor1) ?? num(tt?.torpor1),
    torporIncrease: num(t?.torporincrease) ?? num(tt?.torporIncrease),
    torporDepletionPS0: num(t?.torpordepletionps0) ?? num(tt?.torporDepletionPS0),
    ineffectiveness: num(t?.tameineffectivenessbyaffinity) ?? num(tt?.tamingIneffectiveness),
    foodConsumptionBase: num(t?.foodconsumptionbase) ?? num(tt?.foodConsumptionBase),
    foodConsumptionMult: num(t?.foodconsumptionmult) ?? num(tt?.foodConsumptionMult),
    favoriteKibble: str(tt?.favoriteKibble) ?? str(dvEntry?.tamingfood?.kibble),
    favoriteFood: str(dvEntry?.tamingfood?.favoritefood),
    eats: Array.isArray(tt?.eats) ? tt.eats : null,
    specialFoodValues: tt?.specialFoodValues ?? null,
    // 以下はテイム計算に要る補正。持っている生物の方が少ない
    wakeAffinityMult: num(tt?.wakeAffinityMult),
    wakeFoodDeplMult: num(tt?.wakeFoodDeplMult),
    usesCustomAffinityLogic: tt?.usesCustomAffinityLogic ? true : null,
    constantFeedingInterval: num(tt?.constantFeedingInterval),
    resultCorrection: num(tt?.resultCorrection),
  };
  if (t) {
    out.method = t.knockouttame === 'Yes' ? 'knockout' : t.nonviolenttame === 'Yes' ? 'passive' : null;
  }
  // Dv/data にテイム方法が無い生物は、TamingTable の nonViolentTame で判る
  if (!out.method && tt) out.method = tt.nonViolentTame ? 'passive' : 'knockout';
  const value = orNull(out);
  if (!value) return { value: null, source: null };
  const source = [t && 'dv', tt && 'tamingTable'].filter(Boolean).join('+');
  return { value, source };
}

const STAT_KEYS = ['health', 'stamina', 'oxygen', 'food', 'weight', 'torpor', 'damage', 'speed'];

/**
 * ステータスをまとめる。日本語Wikiの「基礎値と成長率」表を優先し、欠けを英語Wikiで補う。
 * @returns {{value: object|null, source: string|null, conflicts: object[]}}
 */
function buildStats(statsRow, jaStat) {
  const en = statsRow
    ? {
        health: num(statsRow.health1),
        stamina: num(statsRow.stamina1),
        oxygen: num(statsRow.oxygen1),
        food: num(statsRow.food1),
        weight: num(statsRow.weight1),
        torpor: num(statsRow.torpor1),
        damage: num(statsRow.damage1),
        speed: num(statsRow.speed1),
      }
    : null;
  const ja = jaStat?.base ?? null;
  const value = {};
  const conflicts = [];
  let fromJa = 0;
  let fromEn = 0;

  for (const key of STAT_KEYS) {
    const j = num(ja?.[key]);
    const e = num(en?.[key]);
    if (j !== null && e !== null && !near(e, j)) conflicts.push({ field: key, en: e, ja: j });
    if (j !== null) {
      value[key] = j;
      fromJa++;
    } else {
      value[key] = e;
      if (e !== null) fromEn++;
    }
  }
  const source = [fromJa && 'ja', fromEn && 'cargo'].filter(Boolean).join('+') || null;
  return { value: orNull(value), source, conflicts };
}

/** 成長率（野生・テイム後）。英語Wikiからは取っていないので日本語Wiki専用 */
function buildGrowth(jaStat) {
  if (!jaStat) return null;
  const wild = orNull({ ...jaStat.wildGrowth });
  const tamed = orNull({ ...jaStat.tamedGrowth });
  return wild || tamed ? { wild, tamed } : null;
}

/** 0 と負数は「持っていない」とみなす（ASB は該当しない項目に 0 を入れている） */
const posNum = (v) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

const EMPTY_BREEDING = {
  incubationSec: null, gestationSec: null, maturationSec: null,
  matingCooldownMinSec: null, matingCooldownMaxSec: null,
  egg: null, eggTempMin: null, eggTempMax: null,
};

/**
 * 繁殖時間に Smart Breeding（ゲームファイル由来）の値を重ねる。
 * 卵生か胎生かは ASB 側が確定させているので、孵化・妊娠は ASB があれば両方まとめて置き換える。
 */
function applyAsbBreeding(value, asbBreeding, { name, conflicts }) {
  if (!asbBreeding) return { value, used: [] };
  const merged = { ...(value ?? EMPTY_BREEDING) };
  const used = [];
  const put = (field, asbValue) => {
    if (asbValue === null) return;
    const before = merged[field];
    if (Number.isFinite(before) && !near(before, asbValue)) {
      conflicts.push({ name, field, wiki: Math.round(before), asb: Math.round(asbValue) });
    }
    if (!Number.isFinite(before) || !near(before, asbValue)) used.push(field);
    merged[field] = asbValue;
  };

  const incubation = posNum(asbBreeding.incubationTime);
  const gestation = posNum(asbBreeding.gestationTime);
  if (incubation !== null || gestation !== null) {
    put('incubationSec', incubation);
    put('gestationSec', gestation);
    // 片方しか無い場合、もう片方は「無い」が正しい
    if (incubation === null) merged.incubationSec = null;
    if (gestation === null) merged.gestationSec = null;
  }
  put('maturationSec', posNum(asbBreeding.maturationTime));
  put('matingCooldownMinSec', posNum(asbBreeding.matingCooldownMin));
  put('matingCooldownMaxSec', posNum(asbBreeding.matingCooldownMax));
  put('eggTempMin', num(asbBreeding.eggTempMin));
  put('eggTempMax', num(asbBreeding.eggTempMax));
  return { value: merged, used };
}

/**
 * テイム係数に ASB の値を重ねる。
 * 餌のリスト（eats / specialFoodValues / 好物）は Wiki 側のものを使い続ける。
 * 英語Wikiのテイム表と一致することをテストで固定しており、その根拠を崩さないため。
 */
function applyAsbTaming(value, asb, { name, conflicts }) {
  const t = asb?.taming;
  if (!t) return { value, used: [] };
  const merged = {
    method: null, affinityBase: null, affinityPerLevel: null,
    torpor1: null, torporIncrease: null, torporDepletionPS0: null,
    ineffectiveness: null, foodConsumptionBase: null, foodConsumptionMult: null,
    favoriteKibble: null, favoriteFood: null, eats: null, specialFoodValues: null,
    wakeAffinityMult: null, wakeFoodDeplMult: null, usesCustomAffinityLogic: null,
    constantFeedingInterval: null, resultCorrection: null,
    ...(value ?? {}),
  };
  const used = [];
  const put = (field, asbValue) => {
    if (asbValue === null) return;
    const before = merged[field];
    if (Number.isFinite(before) && !near(before, asbValue)) {
      conflicts.push({ name, field, wiki: before, asb: asbValue });
    }
    if (!Number.isFinite(before) || !near(before, asbValue)) used.push(field);
    merged[field] = asbValue;
  };

  put('affinityBase', posNum(t.affinityNeeded0));
  put('affinityPerLevel', posNum(t.affinityIncreasePL));
  put('ineffectiveness', posNum(t.tamingIneffectiveness));
  put('torporDepletionPS0', posNum(t.torporDepletionPS0));
  put('foodConsumptionBase', posNum(t.foodConsumptionBase));
  put('foodConsumptionMult', posNum(t.foodConsumptionMult));
  // 平和テイムの倍率は 0 も意味のある値（餌でaffinityが入らない特殊テイム）
  if (Number.isFinite(num(t.wakeAffinityMult))) merged.wakeAffinityMult = num(t.wakeAffinityMult);
  if (Number.isFinite(num(t.wakeFoodDeplMult))) merged.wakeFoodDeplMult = num(t.wakeFoodDeplMult);
  // 気絶値は ASB ではステータス側にある
  const torpor = asb.statsRaw?.torpor ?? null;
  if (torpor && Number.isFinite(torpor.base)) {
    put('torpor1', torpor.base);
    put('torporIncrease', Number.isFinite(torpor.incWild) ? torpor.base * torpor.incWild : null);
  }
  if (t.nonViolent) merged.method = 'passive';
  else if (t.violent) merged.method = 'knockout';

  return { value: orNull(merged), used };
}

// 近接攻撃と移動速度は ASB では倍率（1 = 100%）で持っている。ゲーム内の表示に合わせて % にする
const PERCENT_STATS = new Set(['damage', 'speed']);
const displayStat = (key, v) => (v === null ? null : PERCENT_STATS.has(key) ? v * 100 : v);

/** ステータスの基礎値に ASB の値を重ねる */
function applyAsbStats(value, statsRaw, { name, conflicts }) {
  if (!statsRaw) return { value, used: [] };
  const merged = { ...(value ?? {}) };
  const used = [];
  for (const [key, raw] of Object.entries(statsRaw)) {
    const asbValue = displayStat(key, num(raw.base));
    if (asbValue === null) continue;
    const before = merged[key];
    if (Number.isFinite(before) && !near(before, asbValue)) {
      conflicts.push({ name, field: key, wiki: before, asb: asbValue });
    }
    if (!Number.isFinite(before) || !near(before, asbValue)) used.push(key);
    merged[key] = asbValue;
  }
  return { value: orNull(merged), used };
}

/**
 * 成長率。日本語Wikiの表が無い生物は ASB の値から作る。
 * 野生は「1レベルあたりの増分」、テイム後は Wiki の表記に合わせて割合（%）で持つ。
 * テイム後の伸びは公式サーバーの既定倍率 0.2 を掛けた値が Wiki に載っている。
 */
function growthFromAsb(statsRaw) {
  if (!statsRaw) return null;
  const wild = {};
  const tamed = {};
  for (const [key, raw] of Object.entries(statsRaw)) {
    const base = displayStat(key, num(raw.base));
    if (base !== null && Number.isFinite(raw.incWild)) wild[key] = round4(base * raw.incWild);
    if (Number.isFinite(raw.incTamed)) tamed[key] = round4(raw.incTamed * 0.2 * 100);
  }
  const w = orNull(wild);
  const t = orNull(tamed);
  return w || t ? { wild: w, tamed: t } : null;
}

const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * 生物データをまとめる。
 * @returns {{creatures: object[], stats: object}}
 */
export function mergeCreatures({
  creatures, creatureStats, dv, tamingCreatures, ja,
  jaTimes = {}, jaNames = {}, jaDossierNames = {}, jaStats = {}, nameOverrides = {},
  asb = new Map(),
}) {
  const dvResolved = resolveInherits(dv);
  const dvByKey = new Map(Object.entries(dvResolved).map(([k, v]) => [norm(k), v]));
  const ttByKey = new Map(Object.entries(tamingCreatures).map(([k, v]) => [norm(k), v]));
  const statsByPage = new Map();
  for (const r of creatureStats) {
    // variant 付きの行は野生の基礎値ではないので、素の行だけ拾う
    if (str(r.variant)) continue;
    if (!statsByPage.has(r._pageName)) statsByPage.set(r._pageName, r);
  }

  const conflicts = [];
  const statConflicts = [];
  const stats = {
    total: creatures.length, asa: 0, ase: 0, asaNew: 0,
    dvMatched: 0, jaMatched: 0, jaFilled: 0, conflicts, statConflicts,
    nameJa: { arkja: 0, wikiwiki: 0, manual: 0, none: 0 },
    statsSource: { asb: 0, ja: 0, cargo: 0, both: 0, none: 0 },
    growth: 0, mapsFromJa: 0, swaps: [],
    asb: { matched: 0, breeding: 0, taming: 0, stats: 0, conflicts: [] },
  };

  // 1回目: 英語Wiki側を組み立てる（入れ替わり検出に全種の値が要る）
  const entries = [];
  for (const row of creatures) {
    const name = str(row.Name);
    if (!name) continue;
    const key = norm(name);
    const dvEntry = dvByKey.get(key);
    if (!isAsaTarget(row, dvEntry)) continue;
    entries.push({
      row,
      name,
      key,
      dvEntry,
      isNew: Boolean(str(row.ReleasedASA)),
      breeding: buildBreeding(dvEntry, row),
      taming: buildTaming(dvEntry, ttByKey.get(key)),
      jaRow: ja[name] ?? null,
      jaTime: jaTimes[name] ?? null,
      jaStat: jaStats[name] ?? null,
    });
  }

  const swapped = new Set();
  for (const pair of findSwappedPairs(entries)) {
    stats.swaps.push(pair);
    swapped.add(pair.a);
    swapped.add(pair.b);
  }

  // 2回目: 日本語Wikiを重ねて出力する
  const out = [];
  for (const e of entries) {
    const { row, name, key, dvEntry, isNew, breeding, taming, jaRow, jaTime, jaStat } = e;

    if (jaTime) {
      const base = breeding.value ?? {
        incubationSec: null, gestationSec: null, maturationSec: null,
        matingCooldownMinSec: null, matingCooldownMaxSec: null,
        egg: null, eggTempMin: null, eggTempMax: null,
      };
      const applied = applyJaTimes(base, jaTime, { name, conflicts, swapped: swapped.has(name) });
      if (applied.used.length) {
        stats.jaFilled++;
        breeding.value = applied.value;
        const tag = `ja(${applied.used.join(',')})`;
        breeding.source = breeding.source ? `${breeding.source}+${tag}` : tag;
      }
    }

    const creatureStat = buildStats(statsByPage.get(name), jaStat);
    for (const c of creatureStat.conflicts) statConflicts.push({ name, ...c });
    let growth = buildGrowth(jaStat);

    // ここから Smart Breeding（ゲームファイル由来）を最優先で重ねる
    const asbEntry = asb.get(str(row.EntityId)) ?? null;
    let statsRaw = null;
    if (asbEntry) {
      stats.asb.matched++;
      const asbConflicts = stats.asb.conflicts;

      const b = applyAsbBreeding(breeding.value, asbEntry.breeding, { name, conflicts: asbConflicts });
      if (b.used.length) {
        stats.asb.breeding++;
        breeding.value = b.value;
        breeding.source = breeding.source ? `asb+${breeding.source}` : 'asb';
      }

      const t = applyAsbTaming(taming.value, asbEntry, { name, conflicts: asbConflicts });
      if (t.used.length) {
        stats.asb.taming++;
        taming.value = t.value;
        taming.source = taming.source ? `asb+${taming.source}` : 'asb';
      }

      const st = applyAsbStats(creatureStat.value, asbEntry.statsRaw, { name, conflicts: asbConflicts });
      if (st.used.length) {
        stats.asb.stats++;
        creatureStat.value = st.value;
        creatureStat.source = creatureStat.source ? `asb+${creatureStat.source}` : 'asb';
      }
      statsRaw = asbEntry.statsRaw;
      // 基礎値を ASB に差し替えたら、伸びも同じ出どころに揃える（近接攻撃と移動速度は % 表記）
      growth = growthFromAsb(asbEntry.statsRaw) ?? growth;
    }
    const maps = mergeMaps(row.WildMaps, jaRow?.wildMaps);

    // 日本語名。手書きの補完を最優先にし、wiki 側が誤っていたときに直せるようにする
    const nameJa = pickJaName(name, nameOverrides, jaNames, jaDossierNames);

    stats.nameJa[nameJa.source ?? 'none']++;
    // 出所は 'asb+ja+cargo' のように連なるので、先頭（最優先で採ったもの）で数える
    const statsFrom = creatureStat.source?.split('+')[0] ?? 'none';
    stats.statsSource[statsFrom] = (stats.statsSource[statsFrom] ?? 0) + 1;
    if (growth) stats.growth++;
    if (maps.source?.includes('ja')) stats.mapsFromJa++;
    stats.asa++;
    if (isNew) stats.asaNew++;
    else stats.ase++;
    if (dvEntry) stats.dvMatched++;
    if (jaRow) stats.jaMatched++;

    out.push({
      key,
      name,
      nameJa: nameJa.value,
      origin: isNew ? 'asa' : 'ase',
      entityId: str(row.EntityId),
      group: str(row.TaxonomicGroup),
      diet: str(row.Diet) ?? str(jaRow?.diet),
      temperament: str(row.Temperament),
      tameable: bool(row.Tameable),
      breedable: bool(row.Breedable),
      rideable: bool(row.Rideable),
      saddle: str(row.Saddle),
      saddleLevel: num(row.SaddleLevel),
      wildMaps: maps.value,
      breeding: breeding.value,
      taming: taming.value,
      stats: creatureStat.value,
      // ASB の生の5つ組（基礎値・野生の伸び・テイム後の伸び・テイム時の加算・乗算）。
      // レベル別のステータス計算に使う
      statsRaw,
      growth,
      ja: jaRow,
      sources: {
        breeding: breeding.source,
        taming: taming.source,
        stats: creatureStat.source,
        wildMaps: maps.source,
        ja: jaRow ? 'wikiwiki' : null,
        nameJa: nameJa.source,
      },
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { creatures: out, stats };
}

/**
 * 日本語名を出所の優先順で選ぶ。
 * 手書きの補完 → ark.wiki.gg 日本語版 → 日本語Wikiのドシエ訳、の順に見る。
 */
function pickJaName(name, overrides, arkja, dossier) {
  for (const [source, table] of [['manual', overrides], ['arkja', arkja], ['wikiwiki', dossier]]) {
    const value = str(table?.[name]);
    if (value) return { value, source };
  }
  return { value: null, source: null };
}

/** アイテムとレシピをまとめる */
export function mergeItems({ items, craftables, consumables, resources }) {
  const byPage = new Map();
  const touch = (pageName) => {
    const name = str(pageName);
    if (!name) return null;
    if (!byPage.has(name)) byPage.set(name, { key: norm(name), name });
    return byPage.get(name);
  };

  for (const r of items) {
    const it = touch(r._pageName);
    if (!it) continue;
    it.itemId = num(r.ID);
    it.category = str(r.Category);
    it.stackSize = num(r.stackSize);
    it.weight = num(r.weight);
    it.blueprint = str(r.Blueprint);
  }

  for (const r of craftables) {
    const it = touch(r._pageName);
    if (!it) continue;
    const ingredients = [];
    for (let i = 1; i <= 15; i++) {
      const name = str(r[`ingredient${i}`]);
      const qty = num(r[`quantity${i}`]);
      if (name && qty) ingredients.push({ name, qty });
    }
    it.crafting = orNull({
      category: str(r.category),
      requiredLevel: num(r.requiredLevel),
      engramPoints: num(r.engramPoints),
      craftingTimeSec: num(r.craftingTime),
      craftedIn: [r.craftedIn, r.craftedIn2, r.craftedIn3, r.craftedIn4, r.craftedIn5, r.craftedIn6]
        .map(str).filter(Boolean),
      ingredients: ingredients.length ? ingredients : null,
    });
  }

  for (const r of consumables) {
    const it = touch(r._pageName);
    if (!it) continue;
    it.consumable = orNull({
      addsFood: num(r.AddsFood),
      addsWater: num(r.AddsWater),
      addsHealth: num(r.AddsHealth),
      addsStamina: num(r.AddsStamina),
      addsTorpor: num(r.AddsTorpor),
      spoilsInSec: num(r.SpoilsIn),
      cookingTimeSec: num(r.CookingTime),
    });
  }

  for (const r of resources) {
    const it = touch(r._pageName);
    if (!it) continue;
    it.resource = orNull({
      rarity: str(r.Rarity),
      renewable: bool(r.Renewable),
      refineable: bool(r.Refineable),
    });
  }

  const out = [...byPage.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { items: out, stats: { total: out.length } };
}
