// Wiki の Module:* が返す Lua テーブルリテラルを JS の値に変換する。
// 対象は Wiki が吐く生成物なので、扱う構文は次の範囲に絞ってある：
//   テーブル / 文字列 / 数値 / true・false・nil / 行コメント・ブロックコメント
// 関数呼び出しや演算式は出てこないため対応しない（出てきたら構文エラーで落とす）。

class Reader {
  constructor(src) {
    this.s = src;
    this.i = 0;
  }

  error(msg) {
    const line = this.s.slice(0, this.i).split('\n').length;
    const near = this.s.slice(this.i, this.i + 40).replace(/\n/g, '\\n');
    throw new Error(`Luaの解析に失敗しました（${line}行目付近）: ${msg} / near: ${near}`);
  }

  // 空白とコメントを読み飛ばす
  skip() {
    for (;;) {
      const before = this.i;
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
      if (this.s.startsWith('--', this.i)) {
        if (this.s.startsWith('--[[', this.i)) {
          const end = this.s.indexOf(']]', this.i + 4);
          this.i = end < 0 ? this.s.length : end + 2;
        } else {
          const end = this.s.indexOf('\n', this.i);
          this.i = end < 0 ? this.s.length : end + 1;
        }
      }
      if (this.i === before) return;
    }
  }

  eat(ch) {
    this.skip();
    if (this.s[this.i] !== ch) this.error(`'${ch}' が必要です`);
    this.i++;
  }

  peek() {
    this.skip();
    return this.s[this.i];
  }

  value() {
    const c = this.peek();
    if (c === '{') return this.table();
    if (c === '"' || c === "'") return this.string();
    if (this.s.startsWith('true', this.i)) return (this.i += 4), true;
    if (this.s.startsWith('false', this.i)) return (this.i += 5), false;
    if (this.s.startsWith('nil', this.i)) return (this.i += 3), null;
    if (c === '-' || c === '.' || (c >= '0' && c <= '9')) return this.number();
    this.error('値として解釈できません');
  }

  string() {
    const quote = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '\\') {
        const e = this.s[this.i++];
        out += { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'" }[e] ?? e;
      } else if (c === quote) {
        return out;
      } else {
        out += c;
      }
    }
    this.error('文字列が閉じられていません');
  }

  number() {
    const m = /^-?(?:0[xX][0-9a-fA-F]+|\d*\.?\d+(?:[eE][-+]?\d+)?)/.exec(this.s.slice(this.i));
    if (!m) this.error('数値として解釈できません');
    this.i += m[0].length;
    return Number(m[0]);
  }

  // キーが一つも無ければ配列、あればオブジェクトとして返す
  table() {
    this.eat('{');
    const named = {};
    const list = [];
    let hasNamed = false;
    for (;;) {
      const c = this.peek();
      if (c === undefined) this.error('テーブルが閉じられていません');
      if (c === '}') {
        this.i++;
        return hasNamed ? Object.assign(named, list.length ? { _list: list } : {}) : list;
      }
      if (c === '[') {
        this.i++;
        const key = this.peek() === '"' || this.peek() === "'" ? this.string() : this.number();
        this.eat(']');
        this.eat('=');
        named[String(key)] = this.value();
        hasNamed = true;
      } else if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i));
        this.i += m[0].length;
        this.eat('=');
        named[m[0]] = this.value();
        hasNamed = true;
      } else {
        list.push(this.value());
      }
      this.skip();
      if (this.s[this.i] === ',' || this.s[this.i] === ';') this.i++;
    }
  }
}

/** Module:* の中身（`return { ... }` 形式）を JS の値にする */
export function parseLuaModule(src) {
  const at = src.indexOf('return');
  if (at < 0) throw new Error('`return` が見つかりません');
  const r = new Reader(src);
  r.i = at + 'return'.length;
  return r.value();
}
