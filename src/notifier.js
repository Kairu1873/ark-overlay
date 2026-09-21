// 通知の送り先を実行環境ごとに切り替える
// - Windows (Electron): メインプロセスが予約を保持 → ウィンドウを閉じてもトレイ常駐で鳴る
// - ブラウザ          : 開いている間だけ Notification API で通知
const electron = typeof window !== 'undefined' ? window.arkTimerDesktop : undefined;

export const platform = electron ? 'windows' : 'web';

export async function requestPermission() {
  if (electron) return true;
  if ('Notification' in window) {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') {
      return (await Notification.requestPermission()) === 'granted';
    }
  }
  return false;
}

/** timers: [{ notifId, name, endAt, durationText }] 実行中のものだけ。毎回この一覧に揃える */
export async function syncSchedules(timers) {
  if (electron) {
    electron.sync(
      timers.map((t) => ({
        id: t.notifId,
        title: t.name,
        body: `時間になりました（${t.durationText}）`,
        at: t.endAt,
      })),
    );
  }
  // ブラウザは app.js 側のティックで発火させる
}

/** アプリが前面にあるときに終了したタイマーの通知（ブラウザ用） */
export function notifyNow(name, body) {
  if (platform === 'web' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(name, { body });
    } catch (_) {
      /* 一部ブラウザは ServiceWorker 経由のみ */
    }
  }
}
