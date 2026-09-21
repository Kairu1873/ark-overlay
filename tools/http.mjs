// Wiki への HTTP アクセスをまとめる。
// - User-Agent に連絡先を入れる
// - ホストごとに間隔を空ける。429 を受けたらその場で間隔を広げる（適応スロットル）
// - 取得のたびにディスクへキャッシュする。開発中の再実行で何度も叩かないため

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const UA = 'ark-timer-data/1.0 (+https://github.com/Kairu1873/ark-timer)';

const CACHE_DIR = path.join(import.meta.dirname, '.cache');
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12時間

// ホストごとの基準間隔。
// wikiwiki.jp は持続的に叩くと 8〜12秒に1回あたりで 429 を返してくる。
// 短い間隔にしても適応スロットルが広げ直すだけで速くならないため、最初から8秒空ける。
const BASE_GAP_MS = {
  'ark.wiki.gg': 1000,
  'wikiwiki.jp': 8000,
};
const MAX_GAP_MS = 60000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hosts = new Map(); // host -> { gap, lastAt }
function hostState(host) {
  if (!hosts.has(host)) hosts.set(host, { gap: BASE_GAP_MS[host] ?? 1000, lastAt: 0 });
  return hosts.get(host);
}

async function waitTurn(host) {
  const st = hostState(host);
  const wait = st.lastAt + st.gap - Date.now();
  if (wait > 0) await sleep(wait);
  st.lastAt = Date.now();
}

/** 429 を受けたら間隔を倍にする。成功が続いたら少しずつ戻す */
function onThrottled(host) {
  const st = hostState(host);
  st.gap = Math.min(st.gap * 2, MAX_GAP_MS);
  return st.gap;
}
function onSuccess(host) {
  const st = hostState(host);
  const base = BASE_GAP_MS[host] ?? 1000;
  if (st.gap > base) st.gap = Math.max(base, Math.round(st.gap * 0.9));
}

/** いま各ホストに対して何ミリ秒間隔で叩いているか（ログ用） */
export const currentGap = (host) => hostState(host).gap;

const cachePath = (url) =>
  path.join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.txt`);

/**
 * URL を取得して本文（文字列）を返す。
 * 429 / 5xx は間隔を広げて再試行する。それでも駄目なら例外を投げる。
 */
export async function fetchText(url, { noCache = false, retries = 6 } = {}) {
  const host = new URL(url).host;
  const file = cachePath(url);

  if (!noCache) {
    try {
      const raw = await readFile(file, 'utf8');
      const nl = raw.indexOf('\n');
      if (Date.now() - Number(raw.slice(0, nl)) < DEFAULT_TTL_MS) return raw.slice(nl + 1);
    } catch (_) {
      /* キャッシュなし */
    }
  }

  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    await waitTurn(host);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 429 || res.status >= 500) {
        const gap = onThrottled(host);
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : gap;
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      onSuccess(host);
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, `${Date.now()}\n${text}`);
      return text;
    } catch (e) {
      // 404 などは再試行しても同じなので即諦める
      if (/HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message)) throw e;
      lastError = e;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error(`取得に失敗しました: ${url} (${lastError?.message})`);
}

export async function fetchJson(url, opt) {
  const data = JSON.parse(await fetchText(url, opt));
  if (data.error) throw new Error(`API エラー: ${data.error.info ?? data.error.code} (${url})`);
  return data;
}
