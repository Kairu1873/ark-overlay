const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage } = require('electron');
const path = require('path');
const wikiData = require('./data');

const APP_ID = 'com.kairu.arkoverlay'; // package.json の build.appId と同じにする（Windows通知に必要）
let win = null;
let tray = null;
let quitting = false;
let schedules = []; // { id, title, body, at }

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(init);
}

function init() {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  // メインプロセスで時刻を監視（ウィンドウを閉じてもトレイ常駐中は通知される）
  setInterval(checkSchedules, 1000);
  // データ更新は起動を待たせない。失敗しても同梱データで動く
  wikiData.checkUpdateInBackground((data) => {
    if (win && !win.isDestroyed()) win.webContents.send('data:updated', data);
  });
}

function createWindow() {
  // ゲームに重ねて使うため、枠なし・背景透過のウィンドウにする。
  // 背景の濃さは www/style.css の --bg（既定で黒30%）が決める。
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
  if (win && !win.isDestroyed()) win.webContents.send('window:state', { alwaysOnTop });
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
      {
        label: '常に手前に表示',
        type: 'checkbox',
        checked: alwaysOnTop,
        click: (item) => setAlwaysOnTop(item.checked),
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
ipcMain.handle('window:state', () => ({ alwaysOnTop }));

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
app.on('window-all-closed', () => {
  /* トレイ常駐のため終了しない */
});
