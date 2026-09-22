// 「図鑑」タブ。生物を英名でも日本語名でも探せる一覧と、その詳細。
// 詳細では、サーバー倍率を適用した孵化・成体・交配CD・インプリントをそのままタイマーにできる。
// Wiki にデータが無い生物は実測値を入力して埋められる。

import { loadData, onDataChanged, searchCreatures, findCreature, getData } from '../data/store.js';
import { RATE_DEFS, normalizeRates } from '../data/rates.js';
import { timersFor, matingCooldownMax, coverageOf } from '../data/resolve.js';
import { tamingPlan, NARCOTIC_DEFS, DEFAULT_TAMING_LEVEL } from '../data/taming.js';

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

// Wiki の分類・食性は英語なので、図鑑の表示だけ日本語にする。
// 気性は自由記述が多いため訳さず、日本語Wikiの記載があればそちらを使う。
const GROUP_JA = {
  Dinosaurs: '恐竜', Reptiles: '爬虫類', Mammals: '哺乳類', Birds: '鳥類',
  Fish: '魚類', Amphibians: '両生類', Invertebrates: '無脊椎動物',
  Synapsids: '単弓類', 'Mechanical Creatures': '機械', Bosses: 'ボス',
};
const DIET_JA = {
  Carnivore: '肉食', Herbivore: '草食', Omnivore: '雑食', Piscivore: '魚食',
  'Bottom Feeder': '底生食', 'Carrion feeder': '腐肉食', Sanguinivore: '吸血',
  Coprophagic: '糞食', Ovivore: '卵食', 'Flame Eater': '炎食', Minerals: '鉱物食',
  'Free Will': '不定', Unknown: '不明',
};
const STAT_LABELS = [
  ['health', '体力'], ['stamina', 'スタミナ'], ['oxygen', '酸素'], ['food', '食料'],
  ['weight', '重量'], ['damage', '近接攻撃'], ['speed', '移動速度'], ['torpor', '気絶値'],
];
const TAMING_METHOD_JA = { knockout: '気絶させてテイム', passive: '平和テイム' };
const KIBBLE_TIERS = ['Basic', 'Simple', 'Regular', 'Superior', 'Exceptional', 'Extraordinary'];

let ctx = null; // { state, save, startTimer, showTimers, setDexAvailable }
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
const groupJa = (c) => (c.group ? GROUP_JA[c.group] ?? c.group : null);
const dietJa = (c) => (c.diet ? DIET_JA[c.diet] ?? c.diet : null);
const temperamentJa = (c) => c.ja?.temperament ?? c.temperament ?? null;

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

function renderList() {
  const el = $('#creatureResults');
  const all = getData().creatures;
  // 詳細を開いている間は一覧を畳む。狭い窓で 200 行の上に詳細が乗ると読めないため
  el.hidden = Boolean(selectedKey) || !all.length;
  if (el.hidden) return;

  const list = searchCreatures($('#creatureQuery').value, { limit: Infinity });
  $('#dexCount').textContent = list.length === all.length ? `${all.length}` : `${list.length}/${all.length}`;
  el.innerHTML = list.length
    ? list
        .map((c) => {
          const cov = coverageOf(c, overrideOf(c.key));
          const badge = cov === 'missing' ? `<span class="chip-warn">データなし</span>` : '';
          const sub = [c.nameJa ? c.name : null, groupJa(c), dietJa(c)].filter(Boolean).join(' / ');
          return `<button class="dex-row" data-creature="${c.key}">
            <span class="dex-name">${esc(c.nameJa ?? c.name)}${badge}</span>
            <span class="dex-sub">${esc(sub)}</span>
          </button>`;
        })
        .join('')
    : `<p class="empty">見つかりません（英名・日本語名で探す。例：Rex／ティラノサウルス）</p>`;
}

/** 繁殖まわりのタイマー行 */
function timerRowsHtml(c) {
  const r = rates();
  const ov = overrideOf(c.key);
  // 繁殖できない生物に「データなし」を並べても仕方がないので、行ごと出さない
  const rows = c.breedable ? timersFor(c, r, ov) : [];
  const cdMax = matingCooldownMax(c, r, ov);

  if (!rows.length) return `<p class="empty">この生物は繁殖できないため、繁殖まわりのタイマーはない</p>`;
  return rows
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
}

/** レベル1の基礎ステータスと、野生1レベルあたりの伸び */
function statsHtml(c) {
  const rows = STAT_LABELS.map(([key, label]) => [key, label, c.stats?.[key]]).filter(
    ([, , v]) => Number.isFinite(v),
  );
  if (!rows.length) return '';
  const wild = c.growth?.wild ?? null;
  return `<div class="dex-block">
    <h4>ステータス<em>レベル1の基礎値${wild ? '／野生1レベルごとの伸び' : ''}</em></h4>
    <div class="stat-grid">
      ${rows
        .map(([key, label, v]) => {
          // 移動速度だけは倍率（%）で、他は実数
          const value = key === 'speed' ? `${v}%` : v;
          const per = wild?.[key];
          const growth = Number.isFinite(per) ? `<i>+${per} /Lv</i>` : '';
          return `<div class="stat"><span>${esc(label)}</span><b>${value}</b>${growth}</div>`;
        })
        .join('')}
    </div>
  </div>`;
}

/**
 * 好物キブルの表記を揃える。
 * Wiki 側が `Superior` `Exceptional Kibble` `Mobile:Kibble (Griffin Egg)` と揺れているので、
 * 等級だけの表記に「のキブル」を足し、それ以外は Wiki の名前をそのまま出す。
 */
function kibbleLabel(value) {
  const raw = String(value).replace(/^[^:]+:/, '').trim();
  const tier = raw.replace(/\s*Kibble$/i, '').trim();
  return KIBBLE_TIERS.includes(tier) ? `${tier} のキブル` : raw || null;
}

const tamingLevel = () => {
  const v = Number(ctx.state.tamingLevel);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : DEFAULT_TAMING_LEVEL;
};

/** 餌の表示名。キブルの行だけ等級を添える */
const foodLabel = (food, creature) =>
  food === 'Kibble' ? kibbleLabel(creature.taming?.favoriteKibble) ?? 'キブル' : food;

/** テイムに要る餌の数・時間・麻酔。計算は data/taming.js */
function tamingRowsHtml(c) {
  const plan = tamingPlan(c, getData().tamingFood, { level: tamingLevel(), rates: rates() });
  if (!plan.rows.length) {
    return `<p class="empty">テイムの数値データがない（英語Wikiに未収載）</p>`;
  }
  const passive = plan.method === 'passive';
  return plan.rows
    .map((row) => {
      const meta = passive
        ? [
            ['給餌間隔', row.feedingInterval === null ? '—' : longDuration(Math.floor(row.feedingInterval))],
            ['合計', longDuration(row.seconds)],
          ]
        : [
            ['時間', longDuration(row.seconds)],
            ...(row.narcotics
              ? NARCOTIC_DEFS.map((d) => [d.label, String(row.narcotics[d.key])])
              : []),
          ];
      return `<div class="tame${row.favorite ? ' fav' : ''}">
        <div class="tame-head">
          <span class="tame-food">${esc(foodLabel(row.food, c))}</span>
          <span class="tame-count">${row.pieces}<em>個</em></span>
          <button type="button" data-tame="${esc(row.food)}" class="primary">開始</button>
        </div>
        <div class="tame-meta">
          ${meta.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}
        </div>
      </div>`;
    })
    .join('');
}

function tamingHtml(c) {
  if (!c.tameable) return '';
  const method = c.taming?.method ? TAMING_METHOD_JA[c.taming.method] ?? c.taming.method : null;
  return `<div class="dex-block">
    <h4>テイム<em>${esc(method ?? '')}</em>
      <label class="lv">Lv<input type="number" id="tamingLevel" min="1" max="999" value="${tamingLevel()}" /></label>
    </h4>
    <div id="tamingRows" class="tame-list">${tamingRowsHtml(c)}</div>
  </div>`;
}

function habitatHtml(c) {
  const rows = [
    ['サドル', c.saddle ? `${c.saddle}${c.saddleLevel ? `（Lv${c.saddleLevel}）` : ''}` : null],
    ['騎乗', c.rideable ? '可能' : '不可'],
    ['出現マップ', c.wildMaps?.length ? c.wildMaps.join('、') : null],
  ].filter(([, v]) => v);
  if (!rows.length) return '';
  return `<div class="dex-block">
    <h4>生息と騎乗</h4>
    ${rows.map(([k, v]) => `<p class="kv"><b>${esc(k)}</b>${esc(v)}</p>`).join('')}
  </div>`;
}

function jaNotesHtml(c) {
  // 日本語Wikiは項目が埋まっていないページもあるので、出す中身があるときだけ枠を作る
  const rows = [
    ['テイム', c.ja?.tamingMethod],
    ['餌', c.ja?.foodPriority],
    ['繁殖', c.ja?.breedingNote],
  ].filter(([, v]) => v);
  if (!rows.length) return '';
  return `<div class="dex-block">
    <h4>日本語Wikiのメモ</h4>
    <div class="ja">${rows.map(([k, v]) => `<p><b>${esc(k)}</b>${esc(v)}</p>`).join('')}</div>
  </div>`;
}

function renderDetail() {
  const el = $('#creatureDetail');
  const c = selectedKey ? findCreature(selectedKey) : null;
  if (!c) {
    el.innerHTML = '';
    return;
  }
  const sub = [c.nameJa ? c.name : null, groupJa(c), dietJa(c), temperamentJa(c)]
    .filter(Boolean)
    .join(' / ');

  el.innerHTML = `<div class="card creature">
    <div class="dex-head">
      <button type="button" id="dexBack" class="link">← 一覧へ戻る</button>
      <h3>${esc(c.nameJa ?? c.name)}${c.origin === 'asa' ? `<span class="tag">ASA新規</span>` : ''}</h3>
      <p class="sub">${esc(sub)}</p>
    </div>
    ${timerRowsHtml(c)}
    ${statsHtml(c)}
    ${tamingHtml(c)}
    ${habitatHtml(c)}
    ${jaNotesHtml(c)}
  </div>`;

  const input = $('#overrideInput');
  if (input) input.focus();
}

export function renderCreatureSection() {
  if (!ctx) return;
  renderRates();
  renderList();
  renderDetail();
}

// ---------- 操作 ----------

function select(key) {
  selectedKey = key;
  editingField = null;
  renderCreatureSection();
  if (key) window.scrollTo({ top: 0 });
}

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
    renderList();
    renderDetail();
  });

  $('#creatureResults').addEventListener('click', (e) => {
    const b = e.target.closest('[data-creature]');
    if (b) select(b.dataset.creature);
  });

  $('#creatureDetail').addEventListener('click', (e) => {
    if (e.target.closest('#dexBack')) return select(null);

    const start = e.target.closest('[data-start]');
    if (start) {
      const c = findCreature(selectedKey);
      const row = timersFor(c, rates(), overrideOf(c.key)).find((x) => x.field === start.dataset.start);
      if (row?.seconds) {
        ctx.startTimer(row.name, Math.round(row.seconds));
        // 押した結果が見えないと動いたのか分からないので、タイマー側へ移る
        ctx.showTimers();
      }
      return;
    }
    const tame = e.target.closest('[data-tame]');
    if (tame) {
      const c = findCreature(selectedKey);
      const plan = tamingPlan(c, getData().tamingFood, { level: tamingLevel(), rates: rates() });
      const row = plan.rows.find((r) => r.food === tame.dataset.tame);
      if (row?.seconds) {
        ctx.startTimer(`${c.nameJa ?? c.name} テイム`, Math.round(row.seconds));
        ctx.showTimers();
      }
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

  // レベルを変えたら表だけ描き直す。詳細ごと描き直すと入力欄から focus が外れるため
  $('#creatureDetail').addEventListener('input', (e) => {
    if (e.target.id !== 'tamingLevel') return;
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 1) return;
    ctx.state.tamingLevel = Math.floor(v);
    ctx.save();
    const c = findCreature(selectedKey);
    const rows = $('#tamingRows');
    if (c && rows) rows.innerHTML = tamingRowsHtml(c);
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

/**
 * @param {{state:object, save:()=>void, startTimer:(name:string,sec:number)=>void,
 *          showTimers:()=>void, setDexAvailable:(ok:boolean)=>void}} context
 */
export async function initCreatures(context) {
  ctx = context;
  if (!$('#creatureQuery')) return;
  bindEvents();
  const refresh = () => {
    // ブラウザで開いたときは生物データが無いので、図鑑そのものを出さない
    ctx.setDexAvailable(getData().creatures.length > 0);
    renderCreatureSection();
  };
  onDataChanged(refresh); // 起動後に更新が届いたときも出し直す
  await loadData();
  refresh();
}
