const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arkOverlayDesktop', {
  // [{ id, title, body, at }] 実行中タイマーの一覧で丸ごと置き換える
  sync: (list) => ipcRenderer.send('schedules:sync', list),

  // 生物・アイテムデータ { creatures, items, tamingFood, meta, source }
  getData: () => ipcRenderer.invoke('data:get'),
  // 起動後にデータが更新されたとき呼ばれる
  onDataUpdated: (cb) => ipcRenderer.on('data:updated', (_e, data) => cb(data)),

  // クリップボード（アイテム名の共通文字列をコピーする）
  clipboard: {
    write: (text) => ipcRenderer.send('clipboard:write', text),
  },

  // アプリ本体の更新（落とし終えると state が入る）
  update: {
    getState: () => ipcRenderer.invoke('update:state'),
    onReady: (cb) => ipcRenderer.on('update:ready', (_e, state) => cb(state)),
    install: () => ipcRenderer.send('update:install'),
  },

  // 枠なしウィンドウの操作
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    hide: () => ipcRenderer.send('window:hide'),
    setAlwaysOnTop: (on) => ipcRenderer.send('window:always-on-top', on),
    getState: () => ipcRenderer.invoke('window:state'),
    onStateChanged: (cb) => ipcRenderer.on('window:state', (_e, state) => cb(state)),
  },
});
