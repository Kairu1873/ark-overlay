// 「アイテム」タブ。日本語名でも英名でも探せて、複数選ぶと共通する文字列を候補として出す。
//
// 探すのは日本語名で構わないが、**出す共通文字列は英名から作る**。
// 候補は「一致件数の少ない順」＝絞り込める順に並ぶ。計算は src/data/items.js。

import { getData, onDataChanged } from '../data/store.js';
import { searchItems, commonStrings } from '../data/items.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LIST_LIMIT = 80; // 2593件あるので、出す行は絞る

let ctx = null; // { state, save }

const picks = () => (Array.isArray(ctx.state.itemPicks) ? ctx.state.itemPicks : []);
const pickedItems = () => {
  const byKey = new Map(getData().items.map((i) => [i.key, i]));
  return picks().map((k) => byKey.get(k)).filter(Boolean);
};

/** クリップボードへ。Electron は本体経由、ブラウザは標準APIにする */
async function copyText(text) {
  const desktop = typeof window !== 'undefined' ? window.arkOverlayDesktop : undefined;
  if (desktop?.clipboard?.write) {
    desktop.clipboard.write(text);
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

// ---------- 描画 ----------

function renderResults() {
  const el = $('#itemResults');
  const all = getData().items;
  if (!all.length) {
    el.innerHTML = `<p class="empty">アイテムデータがありません（Windows版で利用できます）</p>`;
    return;
  }
  const query = $('#itemQuery').value;
  const list = searchItems(all, query, { limit: LIST_LIMIT });
  const chosen = new Set(picks());
  $('#itemCount').textContent = query.trim() ? `${list.length}/${all.length}` : `${all.length}`;

  el.innerHTML = list.length
    ? list
        .map(
          (item) => `<button class="dex-row${chosen.has(item.key) ? ' on' : ''}" data-item="${esc(item.key)}">
            <span class="dex-name">${esc(item.nameJa ?? item.name)}</span>
            <span class="dex-sub">${esc(
              [item.nameJa ? item.name : null, item.category].filter(Boolean).join(' / '),
            )}</span>
          </button>`,
        )
        .join('') +
      (list.length >= LIST_LIMIT
        ? `<p class="empty">${LIST_LIMIT}件まで表示している。検索語を足して絞り込む</p>`
        : '')
    : `<p class="empty">見つかりません（日本語名でも英名でも探せる。例：生肉 / キブル / Raw）</p>`;
}

function renderPicked() {
  const el = $('#itemPicked');
  const chosen = pickedItems();
  if (!chosen.length) {
    el.innerHTML = `<p class="empty">アイテムを選ぶと、共通する文字列が出る（複数選べる）</p>`;
    return;
  }
  const allNames = getData().items.map((i) => i.name);
  const candidates = commonStrings(chosen.map((i) => i.name), allNames, { limit: 8 });

  el.innerHTML = `<div class="card">
    <div class="section-head">
      <h4>選択中 ${chosen.length}件</h4>
      <button type="button" id="clearPicks" class="link">すべて解除</button>
    </div>
    <p class="picked">${chosen
      .map((i) => (i.nameJa ? `${esc(i.nameJa)}<em>${esc(i.name)}</em>` : esc(i.name)))
      .join(' ／ ')}</p>
    <div class="dex-block">
      <h4>共通する文字列<em>英名から作る</em></h4>
      ${
        candidates.length
          ? `<div class="common-list">${candidates
              .map(
                // 前後の空白があるかどうかで一致件数が変わるので、引用符で囲んで見えるようにする
                (c) => `<div class="common">
                  <code>"${esc(c.text)}"</code>
                  <span class="sub">全${c.hits}件に一致</span>
                  <button type="button" data-copy="${esc(c.text)}">コピー</button>
                </div>`,
              )
              .join('')}</div>`
          : `<p class="empty">共通する文字列がない（2文字以上で共通する部分が必要）</p>`
      }
    </div>
  </div>`;
}

export function renderItemSection() {
  if (!ctx || !$('#itemQuery')) return;
  renderPicked();
  renderResults();
}

// ---------- 操作 ----------

function toggle(key) {
  const next = picks().includes(key) ? picks().filter((k) => k !== key) : [...picks(), key];
  ctx.state.itemPicks = next;
  ctx.save();
  renderItemSection();
}

function bindEvents() {
  $('#itemQuery').addEventListener('input', renderResults);

  $('#itemResults').addEventListener('click', (e) => {
    const row = e.target.closest('[data-item]');
    if (row) toggle(row.dataset.item);
  });

  $('#itemPicked').addEventListener('click', async (e) => {
    if (e.target.closest('#clearPicks')) {
      ctx.state.itemPicks = [];
      ctx.save();
      renderItemSection();
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (!copy) return;
    const ok = await copyText(copy.dataset.copy);
    // 押した手応えが無いと入ったか分からないので、一瞬だけ表示を変える
    copy.textContent = ok ? 'コピーした' : 'できない';
    copy.classList.toggle('primary', ok);
    setTimeout(() => {
      copy.textContent = 'コピー';
      copy.classList.remove('primary');
    }, 1200);
  });
}

/** @param {{state:object, save:()=>void, setItemsAvailable:(ok:boolean)=>void}} context */
export function initItems(context) {
  ctx = context;
  if (!$('#itemQuery')) return;
  bindEvents();
  const refresh = () => {
    ctx.setItemsAvailable(getData().items.length > 0);
    renderItemSection();
  };
  onDataChanged(refresh); // 生物データと同じく、起動後に更新が届いたら出し直す
  refresh();
}
