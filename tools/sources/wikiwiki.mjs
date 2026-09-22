// 日本語Wiki（wikiwiki.jp/arksa）から定性情報と繁殖時間を取る。
//
// ASA新規生物は英語Wikiに数値が無いものが多いが、日本語Wikiの「ブリーディング」節には
// 「孵化：4時間59分59秒」「成長まで：5日12時間16分30秒」の形で載っている。
// ここが ASA新規種の穴を埋める唯一の供給源になる。
import { fetchText } from '../http.mjs';

const BASE = 'https://wikiwiki.jp/arksa';
const SITEMAP = `${BASE}/sitemap.txt`;

// 概要テーブルの行見出し → 取り出す先のキー
const ROW_KEYS = [
  [/^テイム時の餌$/, 'foodPriority'],
  [/^テイム(・騎乗)?$/, 'tamingMethod'],
  [/^繁殖$/, 'breedingNote'],
  [/^気(性|質)$/, 'temperament'], // ページによって見出しが「気性」「気質」で揺れる
  [/^食性$/, 'diet'],
  [/^騎乗$/, 'rideable'],
  [/^サドル(制作|作成)に必要なレベル$/, 'saddleLevel'],
  [/^生息MAP$/, 'wildMaps'],
  [/^ドロップ$/, 'drops'],
];

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

function decode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (ENTITIES[e]) return ENTITIES[e];
    if (e[0] === '#') return String.fromCodePoint(Number(e.slice(1).replace(/^x/i, '0x')));
    return m;
  });
}

const text = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// 「ブリーディング」節の行見出し → 取り出す先のキー
const TIME_KEYS = [
  [/^孵化$/, 'incubationSec'],
  [/^妊娠$/, 'gestationSec'],
  [/^成長まで$/, 'maturationSec'],
  [/^幼年期$/, 'babySec'],
];

/** 「5日12時間16分30秒」「4時間59分59秒」→ 秒。読めなければ null */
export function parseJaDuration(s) {
  const m = /^(?:(\d+)\s*日)?\s*(?:(\d+)\s*時間)?\s*(?:(\d+)\s*分)?\s*(?:(\d+)\s*秒)?\s*$/.exec(
    String(s ?? '').trim(),
  );
  if (!m || !m.slice(1).some(Boolean)) return null;
  const [d, h, mi, se] = m.slice(1).map((x) => Number(x || 0));
  const total = d * 86400 + h * 3600 + mi * 60 + se;
  return total > 0 ? total : null;
}

/** ドシエ訳の「名称：アロサウルス」から日本語名を拾う。空欄のページも多い */
function readDossierName(html) {
  for (const line of bodyLines(html)) {
    const m = /^名称\s*[:：]\s*(.+)$/.exec(line);
    if (!m) continue;
    const name = m[1].trim();
    // 書式が崩れたページで本文を丸ごと拾わないよう、長すぎるものは捨てる
    if (name.length <= 30 && /[ぁ-んァ-ヶ一-龥]/.test(name)) return name;
  }
  return null;
}

/** ページ本文を行に分ける（タグを落としただけの素朴なもの） */
function bodyLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((l) => decode(l).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** 「孵化：4時間59分59秒」の並びから繁殖時間を拾う */
function readBreedingTimes(html) {
  const out = {};
  for (const line of bodyLines(html)) {
    const m = /^([^:：]{1,8})\s*[:：]\s*(.+)$/.exec(line);
    if (!m) continue;
    const hit = TIME_KEYS.find(([re]) => re.test(m[1].trim()));
    if (!hit) continue;
    const sec = parseJaDuration(m[2]);
    if (sec !== null) out[hit[1]] ??= sec;
  }
  // 幼年期は成長までのちょうど1/10。両方あるときに食い違うなら拾い方を誤っているので捨てる
  if (out.babySec && out.maturationSec) {
    const ratio = out.maturationSec / out.babySec;
    if (Math.abs(ratio - 10) > 0.5) return {};
  }
  // 成長までが無く幼年期だけある場合は10倍して補う
  if (!out.maturationSec && out.babySec) out.maturationSec = out.babySec * 10;
  delete out.babySec;
  return out;
}

/** sitemap から取れるページ名の集合（英名でそのまま入っている） */
export async function fetchPageNames() {
  const body = await fetchText(SITEMAP);
  const names = new Set();
  for (const line of body.split('\n')) {
    const url = line.trim();
    if (!url.startsWith(`${BASE}/`)) continue;
    const name = decodeURIComponent(url.slice(BASE.length + 1));
    if (name) names.add(name);
  }
  return names;
}

/**
 * 1ページ分を読む。
 * @returns {{info:object|null, times:object, nameJa:string|null}} info=定性情報 / times=繁殖時間（秒）
 */
export async function fetchCreaturePage(name) {
  const html = await fetchText(`${BASE}/${encodeURIComponent(name)}`);
  const info = {};
  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
      const cells = (row.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? []).map(text);
      if (cells.length < 2) continue;
      const hit = ROW_KEYS.find(([re]) => re.test(cells[0]));
      if (hit && cells[1] && !info[hit[1]]) info[hit[1]] = cells[1];
    }
  }
  return {
    info: Object.keys(info).length ? info : null,
    times: readBreedingTimes(html),
    nameJa: readDossierName(html),
  };
}

/**
 * 与えられた生物名のうち、日本語Wikiにページがあるものを順に取得する。
 * @param {string[]} names 英名（英語Wikiの Name をそのまま使える）
 * @param {(done:number,total:number)=>void} onProgress
 */
export async function fetchCreatures(names, onProgress) {
  const pages = await fetchPageNames();
  const targets = names.filter((n) => pages.has(n));
  const info = {};
  const times = {};
  const jaNames = {};
  for (const [i, name] of targets.entries()) {
    try {
      const page = await fetchCreaturePage(name);
      if (page.info) info[name] = page.info;
      if (Object.keys(page.times).length) times[name] = page.times;
      if (page.nameJa) jaNames[name] = page.nameJa;
    } catch (e) {
      // 1ページ落ちても全体は止めない
      console.warn(`  ! ${name} の取得に失敗: ${e.message}`);
    }
    onProgress?.(i + 1, targets.length);
  }
  return { data: info, times, names: jaNames, attempted: targets.length, available: pages.size };
}
