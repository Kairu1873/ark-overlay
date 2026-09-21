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
function fillFromJa(value, jaTimes, conflicts, name) {
  if (!jaTimes) return value;
  const filled = { ...value };
  for (const key of ['incubationSec', 'gestationSec', 'maturationSec']) {
    const ja = jaTimes[key];
    if (!Number.isFinite(ja) || ja <= 0) continue;
    const en = filled[key];
    if (en === null || en === undefined) {
      filled[key] = ja;
      filled._jaFilled = [...(filled._jaFilled ?? []), key];
    } else if (Math.abs(en - ja) / en > 0.01) {
      conflicts.push({ name, field: key, en: Math.round(en), ja });
    }
  }
  return filled;
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
  };
  if (t) {
    out.method = t.knockouttame === 'Yes' ? 'knockout' : t.nonviolenttame === 'Yes' ? 'passive' : null;
  }
  const value = orNull(out);
  if (!value) return { value: null, source: null };
  const source = [t && 'dv', tt && 'tamingTable'].filter(Boolean).join('+');
  return { value, source };
}

function buildStats(statsRow) {
  if (!statsRow) return null;
  return orNull({
    health: num(statsRow.health1),
    stamina: num(statsRow.stamina1),
    oxygen: num(statsRow.oxygen1),
    food: num(statsRow.food1),
    weight: num(statsRow.weight1),
    torpor: num(statsRow.torpor1),
    damage: num(statsRow.damage1),
    speed: num(statsRow.speed1),
  });
}

/**
 * 生物データをまとめる。
 * @returns {{creatures: object[], stats: object}}
 */
export function mergeCreatures({ creatures, creatureStats, dv, tamingCreatures, ja, jaTimes = {} }) {
  const dvResolved = resolveInherits(dv);
  const dvByKey = new Map(Object.entries(dvResolved).map(([k, v]) => [norm(k), v]));
  const ttByKey = new Map(Object.entries(tamingCreatures).map(([k, v]) => [norm(k), v]));
  const statsByPage = new Map();
  for (const r of creatureStats) {
    // variant 付きの行は野生の基礎値ではないので、素の行だけ拾う
    if (str(r.variant)) continue;
    if (!statsByPage.has(r._pageName)) statsByPage.set(r._pageName, r);
  }

  const out = [];
  const conflicts = [];
  const stats = {
    total: creatures.length, asa: 0, ase: 0, asaNew: 0,
    dvMatched: 0, jaMatched: 0, jaFilled: 0, conflicts,
  };

  for (const row of creatures) {
    const name = str(row.Name);
    if (!name) continue;
    const key = norm(name);
    const dvEntry = dvByKey.get(key);
    if (!isAsaTarget(row, dvEntry)) continue;

    const isNew = Boolean(str(row.ReleasedASA));
    const breeding = buildBreeding(dvEntry, row);
    const taming = buildTaming(dvEntry, ttByKey.get(key));
    const jaRow = ja[name] ?? null;

    // 英語側で埋まらなかった項目を日本語Wikiで補う
    const jaTime = jaTimes[name] ?? null;
    if (jaTime) {
      const base = breeding.value ?? {
        incubationSec: null, gestationSec: null, maturationSec: null,
        matingCooldownMinSec: null, matingCooldownMaxSec: null,
        egg: null, eggTempMin: null, eggTempMax: null,
      };
      const filled = fillFromJa(base, jaTime, conflicts, name);
      const jaKeys = filled._jaFilled ?? null;
      delete filled._jaFilled;
      if (jaKeys) {
        stats.jaFilled++;
        breeding.value = filled;
        breeding.source = breeding.source ? `${breeding.source}+ja(${jaKeys.join(',')})` : `ja(${jaKeys.join(',')})`;
      }
    }

    stats.asa++;
    if (isNew) stats.asaNew++;
    else stats.ase++;
    if (dvEntry) stats.dvMatched++;
    if (jaRow) stats.jaMatched++;

    out.push({
      key,
      name,
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
      wildMaps: str(row.WildMaps)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null,
      breeding: breeding.value,
      taming: taming.value,
      stats: buildStats(statsByPage.get(name)),
      ja: jaRow,
      sources: { breeding: breeding.source, taming: taming.source, ja: jaRow ? 'wikiwiki' : null },
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { creatures: out, stats };
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
