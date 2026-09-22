// ARK Smart Breeding（https://github.com/cadon/ARKStatsExtractor, MIT）の値を取る。
//
// ゲームファイルから抽出された値で、版番号が付いている（ASA 92.x / ASE 358.x）。
// Wiki の転記より確かなので、繁殖時間・テイム係数・ステータスはここを第一ソースにする。
//
// 突き合わせは entityId（ブループリント名）で行う。名前で突き合わせると変種の扱いで
// 100種近く取りこぼすことを確認している。
import { fetchText } from '../http.mjs';

const RAW = 'https://raw.githubusercontent.com/cadon/ARKStatsExtractor/dev/ARKBreedingStats';
const FILES = {
  asa: `${RAW}/json/values/ASA-values.json`,
  ase: `${RAW}/json/values/values.json`,
  food: `${RAW}/json/tamingFoodData.json`,
};

// fullStatsRaw の並び（ARKBreedingStats の Stats の定義順）。
// 使わない列（水分・温度・耐性・製作速度）は飛ばす
const STAT_INDEX = [
  [0, 'health'],
  [1, 'stamina'],
  [2, 'torpor'],
  [3, 'oxygen'],
  [4, 'food'],
  [7, 'weight'],
  [8, 'damage'],
  [9, 'speed'],
];

/** ブループリントのパス → entityId（`.../Rex_Character_BP` → `Rex_Character_BP_C`） */
export function entityIdOf(blueprintPath) {
  const cls = String(blueprintPath ?? '').split('/').pop()?.split('.').pop();
  return cls ? `${cls}_C` : null;
}

/** ASB の JSON は BOM 付きなので、そのままでは JSON.parse が落ちる */
async function fetchAsbJson(url) {
  return JSON.parse((await fetchText(url)).replace(/^﻿/, ''));
}

/**
 * `[基礎値, 野生1Lvの伸び, テイム後1Lvの伸び, テイム時の加算, テイム時の乗算]` を
 * ステータス名で引ける形に直す。持っていないステータスは null のまま。
 */
function toStatsRaw(fullStatsRaw) {
  if (!Array.isArray(fullStatsRaw)) return null;
  const out = {};
  for (const [index, key] of STAT_INDEX) {
    const row = fullStatsRaw[index];
    if (!Array.isArray(row) || row.length < 2) continue;
    const [base, incWild, incTamed, addTamed, multTamed] = row.map((v) => (Number.isFinite(v) ? v : null));
    out[key] = { base, incWild, incTamed, addTamed, multTamed };
  }
  return Object.keys(out).length ? out : null;
}

/** 1つの値ファイルを entityId で引ける形にする */
function index(values) {
  const out = new Map();
  for (const species of values.species ?? []) {
    const id = entityIdOf(species.blueprintPath);
    if (!id || out.has(id)) continue;
    out.set(id, species);
  }
  return out;
}

/**
 * ASB の値を取ってくる。
 * @returns {Promise<{byEntityId: Map<string, object>, food: object, versions: object, counts: object}>}
 */
export async function fetchAsbValues() {
  const [asaRaw, aseRaw, foodRaw] = await Promise.all([
    fetchAsbJson(FILES.asa),
    fetchAsbJson(FILES.ase),
    fetchAsbJson(FILES.food),
  ]);

  const asa = index(asaRaw);
  const ase = index(aseRaw);

  // ASA の値を優先し、項目ごとに ASE で穴埋めする（ASA側は差分だけを持つ種がある）
  const byEntityId = new Map();
  for (const id of new Set([...asa.keys(), ...ase.keys()])) {
    const a = asa.get(id);
    const e = ase.get(id);
    const pick = (field) => a?.[field] ?? e?.[field] ?? null;
    byEntityId.set(id, {
      name: a?.name ?? e?.name ?? null,
      origin: a ? 'asa' : 'ase',
      taming: pick('taming'),
      breeding: pick('breeding'),
      statsRaw: toStatsRaw(pick('fullStatsRaw')),
      tamedBaseHealthMultiplier: pick('TamedBaseHealthMultiplier'),
    });
  }

  return {
    byEntityId,
    food: foodRaw.tamingFoodData ?? {},
    versions: { asa: asaRaw.version, ase: aseRaw.version, food: foodRaw.version },
    counts: { asa: asa.size, ase: ase.size, merged: byEntityId.size },
  };
}
