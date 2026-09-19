// 通知の送り先を実行環境ごとに切り替える
// - iOS (Capacitor)   : OSのローカル通知を予約 → アプリを閉じても鳴る
// - Windows (Electron): メインプロセスが予約を保持 → ウィンドウを閉じてもトレイ常駐で鳴る
// - ブラウザ          : 開いている間だけ Notification API で通知
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const isNative = Capacitor.isNativePlatform();
const electron = typeof window !== 'undefined' ? window.arkTimerDesktop : undefined;

export const platform = isNative ? 'ios' : electron ? 'windows' : 'web';

export async function requestPermission() {
  if (isNative) {
    const r = await LocalNotifications.requestPermissions();
    return r.display === 'granted';
  }
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
  if (isNative) {
    const pending = await LocalNotifications.getPending();
    const want = new Map(timers.map((t) => [t.notifId, t]));
    const cancel = pending.notifications
      .filter((n) => {
        // 発火直前のものは消さない（画面側の「完了」判定とのすれ違い対策）
        if (typeof n.extra?.endAt === 'number' && n.extra.endAt <= Date.now() + 2000) return false;
        const t = want.get(n.id);
        return !t || n.extra?.endAt !== t.endAt;
      })
      .map((n) => ({ id: n.id }));
    if (cancel.length) await LocalNotifications.cancel({ notifications: cancel });
    const have = new Set(
      pending.notifications.filter((n) => !cancel.some((c) => c.id === n.id)).map((n) => n.id),
    );
    const add = timers
      .filter((t) => !have.has(t.notifId) && t.endAt > Date.now())
      .map((t) => ({
        id: t.notifId,
        title: t.name,
        body: `時間になりました（${t.durationText}）`,
        schedule: { at: new Date(t.endAt), allowWhileIdle: true },
        extra: { endAt: t.endAt },
      }));
    if (add.length) await LocalNotifications.schedule({ notifications: add });
    return;
  }
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

export function onNotificationTap(cb) {
  if (isNative) {
    LocalNotifications.addListener('localNotificationActionPerformed', (e) => cb(e.notification.id));
  }
}
