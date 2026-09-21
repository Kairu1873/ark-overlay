// 「生物から作る」セクション。
// 生物を選ぶと、サーバー倍率を適用した孵化・成体・交配CD・インプリントが並び、
// そのままタイマーにできる。Wiki にデータが無い生物は実測値を入力して埋められる。

import { loadData, onDataChanged, searchCreatures, findCreature, getData } from '../data/store.js';
import { RATE_DEFS, normalizeRates } from '../data/rates.js';
import { timersFor, matingCooldownMax, coverageOf } from '../data/resolve.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 倍率の適用方向（rates.js の定義を引く）
const rateDefByKey = Object.fromEntries(RATE_DEFS.map((d) => [d.key, d]));
// タイマー行 → どの倍率を使うか
const RATE_FOR_FIELD = {
  incubationSec: 'eggHatchSpeed',
  gestationSec: 'eggHatchSpeed',
  maturationSec: 'babyMatureSpeed',
  matingCooldownMinSec: 'matingInterval',
  cuddle: 'cuddleInterval',
};

let ctx = null; // { state, save, startTimer }
let selectedKey = null;
let showRates = false;
let editingField = null;

/** 「3日20:35」「4:59:58」「29:59」のように読みやすくする */
function longDuration(sec) {
  sec = Math.round(sec);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return d ? `${d}日 ${hms}` : hms;
}

/** 入力欄に入れる用。常に h:mm:ss（時は24を超えてよい）で、parseDuration で読み戻せる */
function plainDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  return `${h}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/** 「1:30:00」「90:00」「5400」のどれでも秒数として受け取る */
function parseDuration(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

const rates = () => normalizeRates(ctx.state.rates);
const overrideOf = (key) => ctx.state.overrides?.[key] ?? null;

/** 実測値（倍率適用後）を 1x 基準に戻す。倍率を変えても追従させるため */
function toBaseSeconds(observedSec, field) {
  const def = rateDefByKey[RATE_FOR_FIELD[field]];
  if (!def) return observedSec;
  const r = rates()[def.key];
  return def.kind === 'speed' ? observedSec * r : observedSec / r;
}

// ---------- 描画 ----------

function renderRates() {
  const el = $('#rates');
  el.hidden = !showRates;
  if (!showRates) return;
  const r = rates();
  el.innerHTML =
    `<p class="hint">ゲーム内／サーバー設定の値を入れる。下の時間に反映される。</p>` +
    RATE_DEFS.map(
      (d) => `<label class="rate-row">
        <span class="rate-label">${esc(d.label)}<em>${esc(d.setting)}</em></span>
        <input type="number" min="0.01" step="0.01" data-rate="${d.key}" value="${r[d.key]}" />
      </label>`,
    ).join('') +
    `<div class="actions"><button type="button" id="resetRates">すべて 1 に戻す</button></div>`;
}

function renderResults() {
  const q = $('#creatureQuery').value;
  const list = searchCreatures(q, { limit: 24 });
  const el = $('#creatureResults');
  if (!getData().creatures.length) {
    el.innerHTML = `<p class="empty">生物データがありません（Windows版で利用できます）</p>`;
    return;
  }
  el.innerHTML = list.length
    ? list
        .map((c) => {
          const cov = coverageOf(c, overrideOf(c.key));
          const badge = cov === 'missing' ? `<span class="chip-warn">データなし</span>` : '';
          return `<button class="chip ${c.key === selectedKey ? 'on' : ''}" data-creature="${c.key}">
            <span class="chip-name">${esc(c.name)}${badge}</span>
            <span class="chip-time">${esc(c.origin === 'asa' ? 'ASA新規' : c.group ?? '')}</span>
          </button>`;
        })
        .join('')
    : `<p class="empty">見つかりません（英名で探す。例：Rex, Argentavis）</p>`;
}

function renderDetail() {
  const el = $('#creatureDetail');
  const c = selectedKey ? findCreature(selectedKey) : null;
  if (!c) {
    el.innerHTML = '';
    return;
  }
  const r = rates();
  const ov = overrideOf(c.key);
  // 繁殖できない生物に「データなし」を並べても仕方がないので、行ごと出さない
  const rows = c.breedable ? timersFor(c, r, ov) : [];
  const cdMax = matingCooldownMax(c, r, ov);

  const rowHtml = !rows.length
    ? `<p class="empty">この生物は繁殖できないため、繁殖まわりのタイマーはない</p>`
    : rows
    .map((row) => {
      const editing = editingField === row.field;
      const value =
        row.seconds === null
          ? `<span class="none">データなし</span>`
          : `<span class="dur">${longDuration(row.seconds)}</span>` +
            (row.field === 'matingCooldownMinSec' && cdMax !== null && cdMax !== row.seconds
              ? `<span class="sub"> 〜 ${longDuration(cdMax)}</span>`
              : '') +
            (row.manual ? `<span class="tag">手入力</span>` : '');
      const editor = editing
        ? `<div class="editor">
             <input type="text" id="overrideInput" placeholder="1:30:00" value="${row.seconds === null ? '' : plainDuration(row.seconds)}" />
             <button type="button" data-save="${row.field}" class="primary">保存</button>
             ${row.manual ? `<button type="button" data-clear="${row.field}">取消</button>` : ''}
             <p class="hint">いまのサーバーでの実測値を入れる（h:mm:ss / mm:ss / 秒）</p>
           </div>`
        : '';
      return `<div class="crow">
        <div class="crow-main">
          <span class="crow-label">${esc(row.label)}</span>
          ${value}
        </div>
        <span class="btns">
          ${row.seconds !== null ? `<button type="button" data-start="${row.field}" class="primary">開始</button>` : ''}
          ${row.field !== 'cuddle' ? `<button type="button" data-edit="${row.field}" title="実測値を入力">✎</button>` : ''}
        </span>
        ${editor}
      </div>`;
    })
    .join('');

  // 日本語Wikiは項目が埋まっていないページもあるので、出す中身があるときだけ枠を作る
  const jaRows = [
    ['テイム', c.ja?.tamingMethod],
    ['餌', c.ja?.foodPriority],
    ['繁殖', c.ja?.breedingNote],
  ].filter(([, v]) => v);
  const ja = jaRows.length
    ? `<div class="ja">${jaRows.map(([k, v]) => `<p><b>${k}</b>${esc(v)}</p>`).join('')}</div>`
    : '';

  el.innerHTML = `<div class="card creature">
    <div class="section-head">
      <h3>${esc(c.name)}</h3>
      <span class="sub">${esc([c.group, c.diet, c.saddleLevel ? `サドル Lv${c.saddleLevel}` : null].filter(Boolean).join(' / '))}</span>
    </div>
    ${rowHtml}
    ${ja}
  </div>`;

  const input = $('#overrideInput');
  if (input) input.focus();
}

export function renderCreatureSection() {
  if (!ctx) return;
  renderRates();
  renderResults();
  renderDetail();
}

// ---------- 操作 ----------

function saveOverride(field) {
  const c = findCreature(selectedKey);
  const sec = parseDuration($('#overrideInput')?.value);
  if (!c || sec === null || sec <= 0) return;
  ctx.state.overrides ??= {};
  ctx.state.overrides[c.key] ??= {};
  ctx.state.overrides[c.key][field] = toBaseSeconds(sec, field);
  editingField = null;
  ctx.save();
  renderCreatureSection();
}

function clearOverride(field) {
  const c = findCreature(selectedKey);
  if (!c || !ctx.state.overrides?.[c.key]) return;
  delete ctx.state.overrides[c.key][field];
  if (!Object.keys(ctx.state.overrides[c.key]).length) delete ctx.state.overrides[c.key];
  editingField = null;
  ctx.save();
  renderCreatureSection();
}

function bindEvents() {
  $('#creatureQuery').addEventListener('input', () => {
    selectedKey = null;
    editingField = null;
    renderResults();
    renderDetail();
  });

  $('#creatureResults').addEventListener('click', (e) => {
    const b = e.target.closest('[data-creature]');
    if (!b) return;
    selectedKey = selectedKey === b.dataset.creature ? null : b.dataset.creature;
    editingField = null;
    renderCreatureSection();
  });

  $('#creatureDetail').addEventListener('click', (e) => {
    const start = e.target.closest('[data-start]');
    if (start) {
      const c = findCreature(selectedKey);
      const row = timersFor(c, rates(), overrideOf(c.key)).find((x) => x.field === start.dataset.start);
      if (row?.seconds) ctx.startTimer(row.name, Math.round(row.seconds));
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      editingField = editingField === edit.dataset.edit ? null : edit.dataset.edit;
      renderDetail();
      return;
    }
    const save = e.target.closest('[data-save]');
    if (save) return saveOverride(save.dataset.save);
    const clear = e.target.closest('[data-clear]');
    if (clear) return clearOverride(clear.dataset.clear);
  });

  $('#creatureDetail').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'overrideInput') {
      e.preventDefault();
      saveOverride(editingField);
    }
  });

  $('#editRates').addEventListener('click', () => {
    showRates = !showRates;
    $('#editRates').textContent = showRates ? '閉じる' : 'サーバー倍率';
    renderRates();
  });

  $('#rates').addEventListener('change', (e) => {
    const input = e.target.closest('[data-rate]');
    if (!input) return;
    const v = Number(input.value);
    ctx.state.rates = { ...rates(), [input.dataset.rate]: Number.isFinite(v) && v > 0 ? v : 1 };
    ctx.save();
    renderCreatureSection();
  });

  $('#rates').addEventListener('click', (e) => {
    if (!e.target.closest('#resetRates')) return;
    ctx.state.rates = undefined;
    ctx.save();
    renderCreatureSection();
  });
}

/** @param {{state:object, save:()=>void, startTimer:(name:string,sec:number)=>void}} context */
export async function initCreatures(context) {
  ctx = context;
  const section = $('#creatureSection');
  if (!section) return;
  bindEvents();
  const refresh = () => {
    section.hidden = !getData().creatures.length;
    renderCreatureSection();
  };
  onDataChanged(refresh); // 起動後に更新が届いたときも出し直す
  await loadData();
  refresh();
}
