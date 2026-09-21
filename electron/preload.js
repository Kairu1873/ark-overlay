const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arkTimerDesktop', {
  // [{ id, title, body, at }] 実行中タイマーの一覧で丸ごと置き換える
  sync: (list) => ipcRenderer.send('schedules:sync', list),

  // 生物・アイテムデータ { creatures, items, tamingFood, meta, source }
  getData: () => ipcRenderer.invoke('data:get'),
  // 起動後にデータが更新されたとき呼ばれる
  onDataUpdated: (cb) => ipcRenderer.on('data:updated', (_e, data) => cb(data)),
});
