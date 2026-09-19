# ARKタイマー

「ルミナ孵化 1時間30分」のように名前と時間を決めてスタートすると、時間になったとき **「ルミナ孵化」** という通知が届くタイマー。
複数のタイマーを同時に動かせ、よく使う設定はプリセットとして保存できる。

| | Windows | iPhone |
|---|---|---|
| 中身 | Electron（トレイ常駐） | Capacitor（iOSのローカル通知） |
| ウィンドウ／アプリを閉じても通知 | ○（×ボタンでトレイに隠れるだけ。トレイから「終了」すると止まる） | ○（通知はiOSに予約されるので、アプリを完全に終了しても届く） |
| 入手方法 | GitHub Actionsが作るインストーラー | GitHub Actionsが作る署名なしIPA → Sideloadlyで自分のApple IDで署名 |

Macは不要。iOSのビルドはGitHubのクラウド上のMacで行う。

---

## 1. ビルドする（GitHub Actions）

ビルドは `.github/workflows/build.yml` で定義しており、明示的に実行したときだけ動く。`main` への push では動かない。

| きっかけ | 動き |
|---|---|
| Actions タブ → **Build** → **Run workflow**（または `gh workflow run build.yml`） | Windows・iOS の両方をビルド |
| `v*` タグの push（例：`git tag v1.0.0 && git push origin v1.0.0`） | ビルドに加えて Releases ページに成果物を置く |

1. リポジトリの **Actions** タブ → 一番上の実行を開く（数分で完了）
2. 完了した実行ページ下部の **Artifacts** から2つダウンロード
   - `ARKTimer-Windows` … Windowsインストーラー（zipの中に .exe）
   - `ARKTimer-iOS-unsigned` … iPhone用（zipの中に .ipa）

> **ビルド時間の枠**：Public リポジトリならクラウドの Mac を無料・無制限で使える。
> Private だと無料枠（月2,000分）のうち Mac は10倍消費なので、実質 月200分（iOSビルド約20回分）になる。

### 手元でビルドする（Windowsのみ）

```bash
npm install
npm run dist:win   # dist/ARKTimer-Setup-<version>.exe ができる
```

iOS のビルドには Xcode（Mac）が必要なので、Actions を使う。

---

## 2. Windowsに入れる

1. `ARKTimer-Setup-1.0.0.exe` を実行する
   - 「WindowsによってPCが保護されました」と出たら **詳細情報 → 実行**（個人用アプリで署名していないため）
2. 起動すればすぐ使える。**×で閉じてもタスクトレイ（右下）に常駐**し、時間になると通知が出る
3. トレイアイコンを右クリックすると次の項目がある
   - **Windows起動時に自動で起動** … チェックするとPC起動時にトレイで待機する
   - **終了（通知も止まります）** … 完全に終了する（この間は通知されない）

> 通知が出ないとき：Windowsの設定 → システム → 通知 で「ARKタイマー」がオンか、「応答不可（集中モード）」になっていないかを確認する。

---

## 3. iPhoneに入れる（無料Apple ID + Sideloadly）

### 初回だけの準備（Windows側）

1. **iTunes** と **iCloud** をインストールする
   - ⚠️ Microsoft Store版ではなく、Appleサイトの **Web版（直接ダウンロード版）** を入れる（Sideloadlyの要件）
2. [Sideloadly](https://sideloadly.io/) をインストールする
3. iPhoneをUSBでPCにつなぎ、iPhone側で「このコンピュータを信頼」を選ぶ

### インストール

1. Sideloadlyを開き、`ARKTimer-unsigned.ipa` をドラッグする
2. **Apple ID** 欄に自分のApple IDを入力し、**Start** を押す
   - パスワードを聞かれたら入力する（2ファクタ認証のコードも）
   - 普段使いのIDが心配なら、サイドロード専用の無料Apple IDを作ってもよい
3. iPhoneで設定する
   - **設定 → 一般 → VPNとデバイス管理** → 自分のApple ID → **信頼**
   - iOS 16以降：**設定 → プライバシーとセキュリティ → デベロッパモード** をオン（再起動あり）
4. アプリを開き、通知の許可で **許可** を選ぶ

### 7日ごとの再署名について

無料Apple IDで署名したアプリは **7日で起動できなくなる**（データは残る）。

- 期限が来たら、同じ手順でSideloadlyから入れ直せばよい（プリセットや実行中のタイマーは消えない）
- Sideloadlyの **Automatic Refresh**（ipaを入れるときの詳細オプション）を使うと、PCとiPhoneが同じWi-Fiにいる間に自動で再署名される
- 無料IDの制限：同時にサイドロードできるアプリは3つまで

> 将来Apple Developer Program（有料）に入れば、1年有効・TestFlight配信にできる。その場合はワークフローに署名手順を追加する。

---

## 使い方

- **名前＋時間 → 開始**：タイマーがスタートする
- **プリセット保存**：いまの名前と時間をプリセットに保存する。プリセットをタップするとワンタップで開始
- **編集**：プリセットの削除（×）／タップでフォームに読み込み（内容を直して保存し直す）
- タイマーごとに **一時停止・再開・↺（最初から）・削除**、終わったものは **もう一度・消す**

---

## 開発メモ

```
src/        画面のロジック（app.js）と通知の振り分け（notifier.js）
www/        画面（index.html / style.css）※ app.js はビルドで生成
electron/   Windows版（トレイ常駐・通知）
ios/        iOSのXcodeプロジェクト（Capacitor）
.github/workflows/build.yml   クラウドビルド設定
```

- PCで試す：`npm install` → `npm start`
- 画面を変えたら push したあと、Actions で Build を実行すると両OS分が再ビルドされる
- iOSの通知はOSに予約する（最大64件）。Windowsはメインプロセスが1秒ごとに監視する
