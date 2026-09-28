const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  nativeImage,
  clipboard,
  globalShortcut,
} = require('electron');
const path = require('path');
const wikiData = require('./data');
const settings = require('./settings');
const { autoUpdater } = require('electron-updater');

const APP_ID = 'com.kairu.arkoverlay'; // package.json の build.appId と同じにする（Windows通知に必要）
let win = null;
let tray = null;
let quitting = false;
let schedules = []; // { id, title, body, at }
let update = null; // 落とし終えた更新 { version }

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
    // ×で閉じるとトレイに隠れるだけなので、起動し直したつもりでも前の起動のままになる。
    // もう一度起動しようとしたときにも更新を見に行く
    checkForUpdate();
  });
  app.whenReady().then(init);
}

function init() {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  // 保存したキーが他のアプリに取られていたら、使えないまま起動する（設定画面に出す）
  registerShortcut(settings.get().shortcut);
  refreshTrayMenu();
  sendWindowState();
  // メインプロセスで時刻を監視（ウィンドウを閉じてもトレイ常駐中は通知される）
  setInterval(checkSchedules, 1000);
  // データ更新は起動を待たせない。失敗しても同梱データで動く
  wikiData.checkUpdateInBackground((data) => {
    if (win && !win.isDestroyed()) win.webContents.send('data:updated', data);
  });
  initUpdater();
}

/**
 * アプリ本体の更新。起動時に GitHub Releases を見て、新しければ裏で落とす。
 *
 * 当てるのは終了するときで、こちらからは再起動しない。タイマーを動かしたまま使うアプリなので、
 * 勝手に落とすと通知が飛ぶ。急ぎたい人向けに、トレイと画面から「更新して再起動」を出す。
 */
function initUpdater() {
  // 開発中（パッケージ前）は更新の仕組みが動かないので触らない
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    update = { version: info?.version ?? null };
    refreshTrayMenu();
    if (win && !win.isDestroyed()) win.webContents.send('update:ready', update);
  });
  // 更新の失敗でアプリが止まっては困るので、記録するだけにする
  autoUpdater.on('error', (e) => console.warn('更新を確認できませんでした:', e?.message ?? e));

  // 確認は起動時と、もう一度起動しようとしたときだけにする。
  // 付けっぱなしで使うので、黙って定期的に落とし始めても嬉しくない
  checkForUpdate();
}

let checking = false;

/** 更新を見に行く。落とし終えたものがあるときと、確認中のときは何もしない */
function checkForUpdate() {
  if (!app.isPackaged || update || checking) return;
  checking = true;
  autoUpdater
    .checkForUpdates()
    .catch(() => {})
    .finally(() => {
      checking = false;
    });
}

/** 落とし終えた更新を当てて再起動する */
function installUpdate() {
  if (!update) return;
  quitting = true;
  // 第1引数は「無人で当てるか」、第2引数は「当てたあと起動し直すか」。
  // 既定（false, false）だとインストーラの画面が出たうえに、終わってもアプリが起動しない
  autoUpdater.quitAndInstall(true, true);
}

function createWindow() {
  // ゲームに重ねて使うため、枠なし・背景透過のウィンドウにする。
  // 背景の濃さは www/style.css の --bg（既定で黒30%）が決め、設定の「背景の透過率」で変えられる。
  win = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 340,
    minHeight: 480,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    title: 'ARK Overlay',
    icon: path.join(__dirname, 'icon.png'),
    show: !process.argv.includes('--hidden'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  // ゲーム（ボーダーレスウィンドウ）の上に出すため、通常より高い階層で前面に置く
  setAlwaysOnTop(true);
  clickThrough = Boolean(settings.get().clickThrough);
  applyMouse();
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!app.__toldTray && Notification.isSupported()) {
      app.__toldTray = true;
      new Notification({
        title: 'ARK Overlay はトレイで動作中',
        body: 'タイマーは続いています。終了するにはトレイアイコンを右クリック →「終了」',
        silent: true,
      }).show();
    }
  });
}

let alwaysOnTop = true;

function setAlwaysOnTop(on) {
  alwaysOnTop = on;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(on, 'screen-saver');
  if (tray) refreshTrayMenu();
  sendWindowState();
}

let clickThrough = false;
let overBar = false; // マウスが上部のバーに乗っているか
let settingsOpen = false; // 設定画面を開いているか

/**
 * クリックを透過する（ゲームへ素通しする）か。
 * 透過中も上部のバーだけは押せるようにする。forward でマウスの動きだけは画面に届くので、
 * 画面側がバーに乗ったこと・離れたことを知らせてくる（window:hover-bar）。
 * 設定画面を開いている間は、設定を操作できるよう透過しない（window:settings-open）。
 */
function setClickThrough(on) {
  clickThrough = on;
  settings.set({ clickThrough: on });
  applyMouse();
  if (tray) refreshTrayMenu();
  sendWindowState();
}

function applyMouse() {
  if (!win || win.isDestroyed()) return;
  const ignore = clickThrough && !overBar && !settingsOpen;
  win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
}

let shortcut = null; // 登録できているショートカット

/**
 * クリック透過を切り替える全体ショートカットを登録し直す。ゲームに手前を取られていても効く。
 * 他のアプリが使っているキーは登録できないので false を返す（そのときは何も登録されていない）
 */
function registerShortcut(accel) {
  if (shortcut) globalShortcut.unregister(shortcut);
  shortcut = null;
  if (!accel) return true;
  let ok = false;
  try {
    ok = globalShortcut.register(accel, () => setClickThrough(!clickThrough));
  } catch (_) {
    ok = false; // 表記が壊れているとき
  }
  if (ok) shortcut = accel;
  return ok;
}

/** ショートカットを変える。登録できなければ前のキーに戻す */
function setShortcut(accel) {
  const prev = shortcut;
  const next = accel ? String(accel) : null;
  const ok = registerShortcut(next);
  if (ok) settings.set({ shortcut: next });
  else registerShortcut(prev);
  if (tray) refreshTrayMenu();
  sendWindowState();
  return { ok, shortcut };
}

const windowState = () => ({
  alwaysOnTop,
  clickThrough,
  shortcut,
  // 保存してあるのに登録できなかったキー（他のアプリが使っている）
  shortcutUnavailable: settings.get().shortcut && !shortcut ? settings.get().shortcut : null,
});

function sendWindowState() {
  if (win && !win.isDestroyed()) win.webContents.send('window:state', windowState());
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('ARK Overlay');
  tray.on('click', showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  const login = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '開く', click: showWindow },
      ...(update
        ? [{ label: `更新して再起動（${update.version ?? '新しい版'}）`, click: installUpdate }]
        : []),
      {
        label: '常に手前に表示',
        type: 'checkbox',
        checked: alwaysOnTop,
        click: (item) => setAlwaysOnTop(item.checked),
      },
      {
        label: 'クリックを透過（上部のバーは押せる）',
        // キーは表示するだけ。登録は globalShortcut が持つ
        ...(shortcut ? { accelerator: shortcut, registerAccelerator: false } : {}),
        type: 'checkbox',
        checked: clickThrough,
        click: (item) => setClickThrough(item.checked),
      },
      {
        label: 'Windows起動時に自動で起動',
        type: 'checkbox',
        checked: login,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
          refreshTrayMenu();
        },
      },
      { type: 'separator' },
      {
        label: '終了（通知も止まります）',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  const next = schedules.slice().sort((a, b) => a.at - b.at)[0];
  tray.setToolTip(next ? `ARK Overlay\n次：${next.title}（${fmt(next.at)}）` : 'ARK Overlay');
}

const fmt = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

ipcMain.handle('data:get', () => wikiData.get());

// 枠が無いぶん、最小化・トレイへ隠す・前面固定は画面側のボタンから呼ぶ
ipcMain.on('window:minimize', () => win?.minimize());
ipcMain.on('window:hide', () => win?.close()); // close は握って hide になる
ipcMain.on('window:always-on-top', (_e, on) => setAlwaysOnTop(Boolean(on)));
ipcMain.on('window:click-through', (_e, on) => setClickThrough(Boolean(on)));
ipcMain.on('window:hover-bar', (_e, on) => {
  overBar = Boolean(on);
  applyMouse();
});
ipcMain.on('window:settings-open', (_e, on) => {
  settingsOpen = Boolean(on);
  applyMouse();
});
ipcMain.handle('window:state', () => windowState());
ipcMain.handle('shortcut:set', (_e, accel) => setShortcut(accel));

// 更新まわり
ipcMain.handle('update:state', () => update);
ipcMain.on('update:install', installUpdate);

// アイテム名の共通文字列をゲームの検索欄に貼るため、画面側からコピーできるようにする
ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text ?? '')));

ipcMain.on('schedules:sync', (_e, list) => {
  // 画面側が「完了」にした直後の同期で消えてしまわないよう、先に期限切れ分を通知する
  checkSchedules();
  schedules = Array.isArray(list) ? list.filter((s) => s && typeof s.at === 'number') : [];
  refreshTrayMenu();
});

function checkSchedules() {
  const now = Date.now();
  const due = schedules.filter((s) => s.at <= now);
  if (!due.length) return;
  schedules = schedules.filter((s) => s.at > now);
  for (const s of due) {
    const n = new Notification({
      title: s.title,
      body: s.body,
      icon: path.join(__dirname, 'icon.png'),
      urgency: 'critical',
      timeoutType: 'never',
    });
    n.on('click', showWindow);
    n.show();
  }
  if (win) win.flashFrame(true);
  refreshTrayMenu();
}

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  /* トレイ常駐のため終了しない */
});
