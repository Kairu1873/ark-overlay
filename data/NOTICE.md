# data/ 配下のデータについて

このディレクトリの JSON は ARK のコミュニティ Wiki から機械的に取得・加工したものであり、
**リポジトリ本体のライセンス（MIT）は適用されない**。

## 出典とライセンス

| ファイル | 出典 | ライセンス |
|---|---|---|
| `creatures.json`（英名・テイム係数・交配クールダウン・アイテム関連） | [ARK Official Community Wiki](https://ark.wiki.gg/) | CC BY-NC-SA 4.0 |
| `creatures.json` の `stats` `growth` `wildMaps`、および `sources` が `ja` の数値 | [ARK: Survival Ascended 攻略Wiki](https://wikiwiki.jp/arksa/) | 各Wikiの規定に従う |
| `creatures.json` の `ja` フィールド、および `sources.breeding` が `ja(...)` の繁殖時間 | [ARK: Survival Ascended 攻略Wiki](https://wikiwiki.jp/arksa/) | 各Wikiの規定に従う |
| `creatures.json` の `nameJa`（`sources.nameJa` が `arkja`） | [ARKコミュニティ公式Wiki 日本語版](https://ark.wiki.gg/ja/) | CC BY-NC-SA 4.0 |
| `creatures.json` の `nameJa`（`sources.nameJa` が `wikiwiki`） | [ARK: Survival Ascended 攻略Wiki](https://wikiwiki.jp/arksa/) | 各Wikiの規定に従う |
| `ja-names.json` | どちらのWikiにも日本語名が無い生物の手書き補完（日本語Wikiの本文表記に合わせた） | — |
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

**同じ項目が両方のWikiにある場合は日本語Wikiを採る。** ARK: Survival Ascended では英語Wikiの
更新が追いついておらず、「英語Wikiに無いが日本語Wikiにはある」が頻発するためである。
英語Wikiは、日本語Wikiに無いものを補う側として使う（日本語Wikiにページが無い生物が26種あり、
テイム係数とアイテム・レシピは英語Wikiにしか無い）。

項目ごとの採用順と、`sources.*` に記録する値は次のとおり。

| 項目 | 採用順 | `sources` の値 |
|---|---|---|
| 繁殖時間 | 日本語Wikiの「ブリーディング」節 → `Module:Dv/data` → Cargo | `ja(...)` / `dv` / `cargo` / `cargo(BabyTime x10)` |
| ステータス | 日本語Wikiの「基礎値と成長率」表 → Cargo の `CreatureStats` | `ja` / `cargo` / `ja+cargo` |
| 成長率 | 日本語Wikiのみ（英語Wikiからは取っていない） | — |
| 出現マップ | 両方の**和集合** | `cargo` / `ja` / `cargo+ja` |
| テイム係数・交配クールダウン | 英語Wikiのみ（日本語Wikiに数値が無い） | `dv+tamingTable` など |

数値が同じなら（1%以内なら同じとみなす）、小数を持っている英語側の値を残す。日本語Wikiは
秒数を1秒単位に丸めているためで、タイマーの表示には影響しない。

食い違った場合はどちらを採ったかも含めて `meta.json` に残す（繁殖時間は `conflicts`、
ステータスは `statConflicts`）。

### 取り違えの検出

**「生物Aの日本語の値＝生物Bの英語の値」かつ「生物Bの日本語の値＝生物Aの英語の値」**が
同じ項目で成り立つ場合、どちらかのWikiが2種を取り違えているとみなし、**その組では日本語Wikiを
採らない**。検出結果は `meta.json` の `suspectSwaps` に残る。実際に Baryonyx と Basilisk が
この形で入れ替わっている。

日本語名は次の順で採用し、`sources.nameJa` にどれを使ったか記録している。

1. `data/ja-names.json`（手書きの補完） → `manual`。Wiki 側が誤っていたときに直せるよう最優先にしてある
2. 英語Wikiの日本語版に置かれた英名のリダイレクト（`Rex` → `ティラノサウルス`） → `arkja`
3. 日本語Wikiのドシエ訳の「名称：」 → `wikiwiki`

どれにも無い場合は `null` とし、アプリでは英名だけで表示・検索する。

## データの欠損について

ASA で新規追加された生物は、英語Wiki側に数値が未収載のものが多い。日本語Wikiで多くは埋まるが、
それでも欠ける場合は該当フィールドが `null` になる。**`0` や空オブジェクトにはしない**（アプリ側が「データあり」と誤認しないため）。
アプリでは「データなし」と表示し、利用者が自分で値を入力できる。
