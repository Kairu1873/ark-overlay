// ウィンドウに関わる設定（クリック透過など）の保存。
//
// 画面側の設定は localStorage に置いているが、ここにあるものは窓を作る時点でメインプロセスが
// 知っている必要があるため、userData/settings.json に置く。
// 読めなければ既定で動く。書き込みに失敗しても、その起動の間は変えた値のまま動く。

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  clickThrough: false, // クリックをゲームへ素通しするか
};

// userData は app.setName の影響を受けるので、ready 前に確定させない
const file = () => path.join(app.getPath('userData'), 'settings.json');

let current = null;

function get() {
  if (!current) {
    try {
      current = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
    } catch (_) {
      current = { ...DEFAULTS };
    }
  }
  return current;
}

function set(patch) {
  current = { ...get(), ...patch };
  fs.promises
    .writeFile(file(), JSON.stringify(current, null, 2))
    .catch((e) => console.warn('設定を保存できませんでした:', e?.message ?? e));
  return current;
}

module.exports = { get, set };
