# data/ 配下のデータについて

このディレクトリの JSON は ARK のコミュニティ Wiki から機械的に取得・加工したものであり、
**リポジトリ本体のライセンス（MIT）は適用されない**。

## 出典とライセンス

| ファイル | 出典 | ライセンス |
|---|---|---|
| `creatures.json` の数値（繁殖時間・テイム係数・ステータス） | [ARK Smart Breeding](https://github.com/cadon/ARKStatsExtractor)（ゲームファイルから抽出された値） | MIT |
| `creatures.json`（英名・分類・食性・気性・サドル・アイテム関連） | [ARK Official Community Wiki](https://ark.wiki.gg/) | CC BY-NC-SA 4.0 |
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
Smart Breeding の値は GitHub の raw から `values.json` / `ASA-values.json` / `tamingFoodData.json` を
取り、生物との突き合わせは `entityId`（ブループリント名）で行う。
実行は `.github/workflows/data.yml`（週1回）と手動実行に限られ、**アプリの実行時に Wiki へアクセスすることはない**。

取得時のマナーとして、User-Agent に連絡先を入れ、リクエスト間隔を空け、結果をキャッシュしている。

## 値の優先順位

**数値は Smart Breeding を最優先で採る。** ARK Smart Breeding（ARKStatsExtractor）の値は
ゲームファイルから抽出されたもので、版番号が付いている（ASA `92.x` / ASE `358.x`）。人手の転記を
挟む Wiki より確かで、ASA の新規生物も収録されている。実際、英語Wikiの `Module:Dv/data` には
Electrophorus の気絶値に食料消費の値が入っているといった取り違えがあり、これを上書きして直している。

Wiki は Smart Breeding に無い25種の穴埋めと、日本語名・分類・食性・気性・サドル・出現マップ・
テイム方法の文章・アイテムを担う。Wiki 同士では日本語Wikiを優先する（ASA への追従が早いため）。

項目ごとの採用順と、`sources.*` に記録する値は次のとおり。

| 項目 | 採用順 | `sources` の値 |
|---|---|---|
| 繁殖時間 | Smart Breeding → 日本語Wikiの「ブリーディング」節 → `Module:Dv/data` → Cargo | `asb` / `ja(...)` / `dv` / `cargo` |
| テイム係数 | Smart Breeding → `Module:Dv/data` + `Module:TamingTable` | `asb` / `dv+tamingTable` |
| ステータス | Smart Breeding → 日本語Wikiの「基礎値と成長率」表 → Cargo | `asb` / `ja` / `cargo`（連結する） |
| 成長率 | Smart Breeding の伸び → 日本語Wikiの表 | — |
| 餌のリスト・好物 | 英語Wiki（`Module:TamingTable`）のみ | — |
| 出現マップ | 英語Wikiと日本語Wikiの**和集合** | `cargo` / `ja` / `cargo+ja` |

`statsRaw` は Smart Breeding の生の5つ組（基礎値・野生1レベルの伸び・テイム後1レベルの伸び・
テイム時の加算・テイム時の乗算）で、レベル別のステータス計算に使う。近接攻撃と移動速度は
向こうでは倍率（1 = 100%）で持っているため、表示用の `stats` と `growth` では % に直している。

**餌のリストだけは英語Wikiのものを使い続ける。** テイム計算の結果が英語Wikiの公開している
テイム表と一致することをテストで固定しており、その根拠を崩さないためである。

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
