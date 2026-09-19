const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arkTimerDesktop', {
  // [{ id, title, body, at }] 実行中タイマーの一覧で丸ごと置き換える
  sync: (list) => ipcRenderer.send('schedules:sync', list),
});
