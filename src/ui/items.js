// 「アイテム」タブ。探して1つ選ぶ、をくり返して積み上げ、共通する文字列を候補として出す。
//
// 「非対象」に積んだものに当たってしまう候補は出さない。腐った肉は対象にしたいが生肉は外したい、
// のように似た名前を分けたいときに使う。
// 出すのは「一番短い候補」1件だけ。非対象を指定してあれば、短くても取りこぼさない。
// 選ぶと検索欄が空になり、そのまま次の語を打てる。積んだものは × で個別に外せる。
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
const excludes = () => (Array.isArray(ctx.state.itemExcludes) ? ctx.state.itemExcludes : []);
/** いま選んだものを入れる先。'pick'（対象）か 'exclude'（非対象） */
const mode = () => (ctx.state.itemPickMode === 'exclude' ? 'exclude' : 'pick');

const itemsOf = (keys) => {
  const byKey = new Map(getData().items.map((i) => [i.key, i]));
  return keys.map((k) => byKey.get(k)).filter(Boolean);
};
const pickedItems = () => itemsOf(picks());
const excludedItems = () => itemsOf(excludes());

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
  const chosen = new Set([...picks(), ...excludes()]);
  if (!query.trim()) {
    $('#itemCount').textContent = `${all.length}`;
    el.innerHTML = `<p class="empty">検索して1つ選ぶ、をくり返すと${
      mode() === 'exclude' ? '非対象に積み上がる' : '対象に積み上がる'
    }</p>`;
    return;
  }
  const list = searchItems(all, query, { limit: LIST_LIMIT });
  $('#itemCount').textContent = `${list.length}/${all.length}`;

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

/** 積んだものをチップで並べる */
function chipsHtml(list, kind) {
  return `<div class="picks">${list
    .map(
      (i) => `<span class="pick${kind === 'exclude' ? ' out' : ''}">
        <b>${esc(i.nameJa ?? i.name)}</b>${i.nameJa ? `<em>${esc(i.name)}</em>` : ''}
        <button type="button" class="pick-del" data-unpick="${esc(i.key)}" data-kind="${kind}" title="外す">×</button>
      </span>`,
    )
    .join('')}</div>`;
}

function renderPicked() {
  const el = $('#itemPicked');
  const chosen = pickedItems();
  const skipped = excludedItems();
  if (!chosen.length && !skipped.length) {
    el.innerHTML = `<p class="empty">アイテムを選ぶと、共通する文字列が出る（1つずつ積み上げる）</p>`;
    return;
  }
  const allNames = getData().items.map((i) => i.name);
  // 出すのは一番短い1件だけ。候補を並べても選びようがない
  const candidates = chosen.length
    ? commonStrings(chosen.map((i) => i.name), allNames, {
        limit: 1,
        order: 'length',
        exclude: skipped.map((i) => i.name),
      })
    : [];

  el.innerHTML = `<div class="card">
    <div class="section-head">
      <h4>対象 ${chosen.length}件${skipped.length ? ` / 非対象 ${skipped.length}件` : ''}</h4>
      <button type="button" id="clearPicks" class="link">すべて解除</button>
    </div>
    ${chosen.length ? chipsHtml(chosen, 'pick') : ''}
    ${skipped.length ? `<p class="hint">非対象（この文字列に当たってほしくないもの）</p>${chipsHtml(skipped, 'exclude')}` : ''}
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
          : !chosen.length
            ? `<p class="empty">対象にアイテムを選ぶ</p>`
            : skipped.length
              ? `<p class="empty">非対象に当たらない文字列が無い（非対象を減らすか、対象を絞る）</p>`
              : `<p class="empty">共通する文字列がない（2文字以上で共通する部分が必要）</p>`
      }
    </div>
  </div>`;
}

function renderMode() {
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.classList.toggle('on', b.dataset.mode === mode());
  }
}

export function renderItemSection() {
  if (!ctx || !$('#itemQuery')) return;
  renderMode();
  renderPicked();
  renderResults();
}

// ---------- 操作 ----------

/** 1つ積む。検索欄は空にして、そのまま次の語を打てるようにする */
function add(key) {
  // 同じものが両方に入らないようにする
  ctx.state.itemPicks = picks().filter((k) => k !== key);
  ctx.state.itemExcludes = excludes().filter((k) => k !== key);
  if (mode() === 'exclude') ctx.state.itemExcludes = [...ctx.state.itemExcludes, key];
  else ctx.state.itemPicks = [...ctx.state.itemPicks, key];
  ctx.save();

  const input = $('#itemQuery');
  if (input) input.value = '';
  renderItemSection();
  input?.focus();
}

function remove(key, kind) {
  if (kind === 'exclude') ctx.state.itemExcludes = excludes().filter((k) => k !== key);
  else ctx.state.itemPicks = picks().filter((k) => k !== key);
  ctx.save();
  renderItemSection();
}

function setMode(next) {
  ctx.state.itemPickMode = next;
  ctx.save();
  renderItemSection();
  $('#itemQuery')?.focus();
}

function bindEvents() {
  $('#itemQuery').addEventListener('input', renderResults);

  $('#itemMode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });

  $('#itemResults').addEventListener('click', (e) => {
    const row = e.target.closest('[data-item]');
    if (row) add(row.dataset.item);
  });

  $('#itemPicked').addEventListener('click', async (e) => {
    const unpick = e.target.closest('[data-unpick]');
    if (unpick) return remove(unpick.dataset.unpick, unpick.dataset.kind);

    if (e.target.closest('#clearPicks')) {
      ctx.state.itemPicks = [];
      ctx.state.itemExcludes = [];
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
