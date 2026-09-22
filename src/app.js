import { platform, requestPermission, syncSchedules, notifyNow } from './notifier.js';
import { initCreatures } from './ui/creatures.js';

const STORE_KEY = 'arkOverlay.v1';
const DEFAULT_PRESETS = [{ id: 'p1', name: 'ルミナ孵化', seconds: 90 * 60 }];

// ---------- 状態 ----------
// rates（サーバー倍率）・overrides（生物ごとの手入力値）・tab（開いていたタブ）は後から足した任意キー。
// 既存の保存内容を壊さないよう、STORE_KEY は据え置きで既定値を埋める。
let state = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.presets) && Array.isArray(s.timers)) {
      return { rates: undefined, overrides: {}, tab: 'timer', ...s };
    }
  } catch (_) {}
  return { presets: DEFAULT_PRESETS, timers: [], rates: undefined, overrides: {}, tab: 'timer' };
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (_) {}
}
const uid = () => Math.random().toString(36).slice(2, 10);
const notifId = () => 1 + Math.floor(Math.random() * 2_000_000_000);

// ---------- 表示用 ----------
export function durationText(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h}時間`);
  if (m) parts.push(`${m}分`);
  if (s || !parts.length) parts.push(`${s}秒`);
  return parts.join('');
}
function clock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function endClock(ms) {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`;
}
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const remainingOf = (t) =>
  t.state === 'running' ? (t.endAt - Date.now()) / 1000 : t.state === 'paused' ? t.remaining : 0;

// ---------- 操作 ----------
function startTimer(name, seconds) {
  if (!name.trim() || seconds <= 0) return;
  state.timers.push({
    id: uid(),
    notifId: notifId(),
    name: name.trim(),
    seconds,
    state: 'running',
    endAt: Date.now() + seconds * 1000,
  });
  commit();
}
function act(id, action) {
  const i = state.timers.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = state.timers[i];
  if (action === 'pause' && t.state === 'running') {
    t.remaining = Math.max(1, Math.ceil((t.endAt - Date.now()) / 1000));
    t.state = 'paused';
    delete t.endAt;
  } else if (action === 'resume' && t.state === 'paused') {
    t.endAt = Date.now() + t.remaining * 1000;
    t.state = 'running';
    t.notifId = notifId();
    delete t.remaining;
  } else if (action === 'restart') {
    t.state = 'running';
    t.endAt = Date.now() + t.seconds * 1000;
    t.notifId = notifId();
    delete t.remaining;
  } else if (action === 'delete') {
    state.timers.splice(i, 1);
  }
  commit();
}
function commit() {
  save();
  render();
  syncSchedules(
    state.timers
      .filter((t) => t.state === 'running')
      .map((t) => ({ notifId: t.notifId, name: t.name, endAt: t.endAt, durationText: durationText(t.seconds) })),
  ).catch((e) => console.error(e));
}

// ---------- アラーム音（アプリが前面のとき） ----------
let audio;
function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (_) {}
}
function beep() {
  if (!audio) return;
  const now = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    o.type = 'triangle';
    g.gain.setValueAtTime(0.0001, now + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.4, now + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.28);
    o.connect(g).connect(audio.destination);
    o.start(now + i * 0.35);
    o.stop(now + i * 0.35 + 0.3);
  }
}

// ---------- 描画 ----------
const $ = (sel) => document.querySelector(sel);
let editPresets = false;

/** 「タイマー」「図鑑」の切り替え。開いていたタブは次回の起動に持ち越す */
function setTab(tab) {
  state.tab = tab;
  save();
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;
}

/** 生物データが無い環境（ブラウザ）では図鑑そのものを出さない */
function setDexAvailable(ok) {
  $('#tabDex').hidden = !ok;
  if (!ok && state.tab === 'dex') setTab('timer');
}

function render() {
  // プリセット
  const pl = $('#presets');
  pl.classList.toggle('editing', editPresets);
  pl.innerHTML = state.presets.length
    ? state.presets
        .map(
          (p) => `<button class="chip" data-preset="${p.id}">
            <span class="chip-name">${esc(p.name)}</span>
            <span class="chip-time">${durationText(p.seconds)}</span>
            <span class="chip-del" aria-label="削除">×</span>
          </button>`,
        )
        .join('')
    : `<p class="empty">上のフォームから「プリセット保存」で追加できます</p>`;
  $('#editPresets').textContent = editPresets ? '完了' : '編集';
  $('#editPresets').hidden = !state.presets.length && !editPresets;

  // タイマー（完了 → 残りが短い順 → 一時停止）
  const order = { done: 0, running: 1, paused: 2 };
  const list = [...state.timers].sort(
    (a, b) => order[a.state] - order[b.state] || remainingOf(a) - remainingOf(b),
  );
  $('#timerCount').textContent = list.length ? `${list.length}` : '';
  $('#timers').innerHTML = list.length
    ? list
        .map((t) => {
          const btns =
            t.state === 'running'
              ? `<button data-act="pause" data-id="${t.id}">一時停止</button>`
              : t.state === 'paused'
                ? `<button data-act="resume" data-id="${t.id}" class="primary">再開</button>`
                : `<button data-act="restart" data-id="${t.id}" class="primary">もう一度</button>`;
          const sub =
            t.state === 'running'
              ? `${endClock(t.endAt)} に終了`
              : t.state === 'paused'
                ? '一時停止中'
                : '完了！';
          return `<article class="timer ${t.state}" data-timer="${t.id}">
            <div class="timer-head">
              <h3>${esc(t.name)}</h3>
              <span class="total">${durationText(t.seconds)}</span>
            </div>
            <div class="remain" data-remain="${t.id}">${t.state === 'done' ? '00:00' : clock(remainingOf(t))}</div>
            <div class="bar"><i data-bar="${t.id}"></i></div>
            <div class="timer-foot">
              <span class="sub">${sub}</span>
              <span class="btns">${btns}
                ${t.state !== 'done' ? `<button data-act="restart" data-id="${t.id}" title="最初から">↺</button>` : ''}
                <button data-act="delete" data-id="${t.id}" class="danger">${t.state === 'done' ? '消す' : '削除'}</button>
              </span>
            </div>
          </article>`;
        })
        .join('')
    : `<p class="empty">実行中のタイマーはありません</p>`;
  tickUI();
}

function tickUI() {
  for (const t of state.timers) {
    const r = remainingOf(t);
    const el = document.querySelector(`[data-remain="${t.id}"]`);
    if (el && t.state !== 'done') el.textContent = clock(r);
    const bar = document.querySelector(`[data-bar="${t.id}"]`);
    if (bar) bar.style.width = `${t.state === 'done' ? 100 : Math.min(100, (1 - r / t.seconds) * 100)}%`;
  }
}

function tick() {
  let changed = false;
  for (const t of state.timers) {
    if (t.state === 'running' && t.endAt <= Date.now()) {
      const late = Date.now() - t.endAt > 60_000; // アプリを閉じていた間に終わったもの
      t.state = 'done';
      delete t.endAt;
      changed = true;
      if (!late) {
        beep();
        notifyNow(t.name, `時間になりました（${durationText(t.seconds)}）`);
      }
    }
  }
  if (changed) commit();
  else tickUI();
}

// ---------- 入力 ----------
function readForm() {
  const n = (id) => Math.max(0, parseInt($(id).value, 10) || 0);
  return { name: $('#name').value, seconds: n('#h') * 3600 + n('#m') * 60 + n('#s') };
}
function showError(msg) {
  const e = $('#formError');
  e.textContent = msg;
  e.hidden = !msg;
}
function validate({ name, seconds }) {
  if (!name.trim()) return showError('名前を入れてください'), false;
  if (seconds <= 0) return showError('時間を入れてください'), false;
  showError('');
  return true;
}

function bind() {
  document.addEventListener('pointerdown', unlockAudio, { passive: true });

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  $('#form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = readForm();
    if (!validate(f)) return;
    startTimer(f.name, f.seconds);
    requestPermission();
  });
  $('#savePreset').addEventListener('click', () => {
    const f = readForm();
    if (!validate(f)) return;
    state.presets.push({ id: uid(), name: f.name.trim(), seconds: f.seconds });
    commit();
  });
  $('#editPresets').addEventListener('click', () => {
    editPresets = !editPresets;
    render();
  });
  $('#presets').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-preset]');
    if (!chip) return;
    const p = state.presets.find((x) => x.id === chip.dataset.preset);
    if (!p) return;
    if (editPresets) {
      if (e.target.closest('.chip-del')) {
        state.presets = state.presets.filter((x) => x.id !== p.id);
        if (!state.presets.length) editPresets = false;
        commit();
      } else {
        // 編集中はフォームに読み込む
        $('#name').value = p.name;
        $('#h').value = Math.floor(p.seconds / 3600) || '';
        $('#m').value = Math.floor((p.seconds % 3600) / 60) || '';
        $('#s').value = p.seconds % 60 || '';
      }
      return;
    }
    startTimer(p.name, p.seconds);
    requestPermission();
  });
  $('#timers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) act(b.dataset.id, b.dataset.act);
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
}

document.documentElement.dataset.platform = platform;
bind();
setTab(state.tab === 'dex' ? 'dex' : 'timer');
tick();
commit();
setInterval(tick, 250);
initCreatures({
  state,
  save,
  startTimer: (name, seconds) => {
    startTimer(name, seconds);
    requestPermission();
  },
  showTimers: () => setTab('timer'),
  setDexAvailable,
});
if (state.timers.length === 0) requestPermission();
