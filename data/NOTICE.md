# data/ 配下のデータについて

このディレクトリの JSON は ARK のコミュニティ Wiki から機械的に取得・加工したものであり、
**リポジトリ本体のライセンス（MIT）は適用されない**。

## 出典とライセンス

| ファイル | 出典 | ライセンス |
|---|---|---|
| `creatures.json`（数値・英名） | [ARK Official Community Wiki](https://ark.wiki.gg/) | CC BY-NC-SA 4.0 |
| `creatures.json` の `ja` フィールド、および `sources.breeding` が `ja(...)` の繁殖時間 | [ARK: Survival Ascended 攻略Wiki](https://wikiwiki.jp/arksa/) | 各Wikiの規定に従う |
| `items.json` | [ARK Official Community Wiki](https://ark.wiki.gg/) | CC BY-NC-SA 4.0 |
| `taming-food.json` | [ARK Official Community Wiki](https://ark.wiki.gg/) `Module:TamingTable/food` | CC BY-NC-SA 4.0 |

ark.wiki.gg のライセンスは [Creative Commons 表示-非営利-継承 4.0 国際](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ja) である。
API の `meta=siteinfo&siprop=rightsinfo` で取得した内容を `meta.json` にも記録している。

この条件により、次の制約がかかる。

- **表示（BY）** … 出典を明示する。アプリ内にもクレジットを表示する
- **非営利（NC）** … 営利目的で利用しない
- **継承（SA）** … 改変して配布する場合は同じライセンスで公開する

## 取得方法

`tools/fetch-wiki.mjs` が取得し、`tools/validate-data.mjs` が検証する。
実行は `.github/workflows/data.yml`（週1回）と手動実行に限られ、**アプリの実行時に Wiki へアクセスすることはない**。

取得時のマナーとして、User-Agent に連絡先を入れ、リクエスト間隔を空け、結果をキャッシュしている。

## 値の優先順位

繁殖時間は次の順で採用し、`sources.breeding` にどれを使ったか記録している。

1. `Module:Dv/data`（英語Wiki・ゲームファイル由来） → `dv`
2. Cargo の `Creatures` テーブル（英語Wiki） → `cargo` / `cargo(BabyTime x10)`
3. 日本語Wikiの「ブリーディング」節 → `ja(...)`。**上の2つが空のときだけ使う**

両方に値があって食い違う場合は英語側を採用し、食い違いの一覧を `meta.json` の `conflicts` に残す。

## データの欠損について

ASA で新規追加された生物は、英語Wiki側に数値が未収載のものが多い。日本語Wikiで多くは埋まるが、
それでも欠ける場合は該当フィールドが `null` になる。**`0` や空オブジェクトにはしない**（アプリ側が「データあり」と誤認しないため）。
アプリでは「データなし」と表示し、利用者が自分で値を入力できる。
