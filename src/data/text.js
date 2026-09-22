// 検索用の文字列の均し方。生物とアイテムで同じ扱いにするため、ここにまとめる。

/**
 * 表記を均す。
 * NFKC で全角英数と半角カナを直し、平仮名を片仮名に寄せ、長音・中黒・空白を落とす。
 * 「てぃらの」「ﾃｨﾗﾉ」「ティラノ」がどれも「ティラノサウルス」に当たるようにするため。
 */
export const fold = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[ー・\s_-]/g, '');

export const NO_MATCH = 99;

/** 完全一致 0 / 前方一致 1 / 部分一致 2 / 一致しない */
export function matchScore(folded, q) {
  if (!folded) return NO_MATCH;
  if (folded === q) return 0;
  if (folded.startsWith(q)) return 1;
  return folded.includes(q) ? 2 : NO_MATCH;
}
