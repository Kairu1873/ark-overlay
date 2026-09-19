# ARKタイマー

「ルミナ孵化 1時間30分」のように名前と時間を決めてスタートすると、時間になったとき **「ルミナ孵化」** という通知が届くタイマーです。
複数のタイマーを同時に動かせて、よく使う設定はプリセットとして保存できます。

| | Windows | iPhone |
|---|---|---|
| 中身 | Electron（トレイ常駐） | Capacitor（iOSのローカル通知） |
| ウィンドウ／アプリを閉じても通知 | ○（×ボタンでトレイに隠れるだけ。トレイから「終了」すると止まる） | ○（通知はiOSに予約されるので、アプリを完全に終了しても届く） |
| 入手方法 | GitHub Actionsが作るインストーラー | GitHub Actionsが作る署名なしIPA → Sideloadlyで自分のApple IDで署名 |

Macは不要です。iOSのビルドはGitHubのクラウド上のMacで行います。

---

## 1. GitHubにアップロードする

1. GitHubで新しいリポジトリを作る（例：`ark-timer`）
   - **Public（公開）を推奨**：公開リポジトリならクラウドのMacを無料・無制限で使えます。
     Privateだと無料枠（月2,000分）のうちMacは10倍消費なので、実質 月200分（iOSビルド約20回分）です。
2. このフォルダの中身を丸ごとpushする

   ```bash
   cd ark-timer
   git init -b main
   git add .
   git commit -m "first commit"
   git remote add origin https://github.com/<あなたのユーザー名>/ark-timer.git
   git push -u origin main
   ```

   コマンドが面倒なら [GitHub Desktop](https://desktop.github.com/) でこのフォルダを追加して「Publish repository」でもOKです。
   （Webの「Upload files」は `.github` フォルダが漏れやすいので非推奨）

3. push すると自動でビルドが始まります。リポジトリの **Actions** タブ → 一番上の実行 → 10分前後で完了
4. 完了した実行ページ下部の **Artifacts** から2つダウンロード
   - `ARKTimer-Windows` … Windowsインストーラー（zipの中に .exe）
   - `ARKTimer-iOS-unsigned` … iPhone用（zipの中に .ipa）

> タグを付けてpushすると（`git tag v1.0.0 && git push --tags`）、Releasesページにも両方が置かれます。

---

## 2. Windowsに入れる

1. `ARKTimer-Setup-1.0.0.exe` を実行
   - 「WindowsによってPCが保護されました」と出たら **詳細情報 → 実行**（個人用アプリで署名していないため）
2. 起動したら使えます。**×で閉じてもタスクトレイ（右下）に常駐**し、時間になると通知が出ます
3. トレイアイコンを右クリック
   - **Windows起動時に自動で起動** … チェックするとPC起動時にトレイで待機
   - **終了** … 完全に終了（この間は通知されません）

> 通知が出ないとき：Windowsの設定 → システム → 通知 で「ARKタイマー」がオンか、「応答不可（集中モード）」になっていないか確認してください。

---

## 3. iPhoneに入れる（無料Apple ID + Sideloadly）

### 初回だけの準備（Windows側）

1. **iTunes** と **iCloud** をインストール
   - ⚠️ Microsoft Store版ではなく、Appleサイトの **Web版（直接ダウンロード版）** を入れてください（Sideloadlyの要件）
2. [Sideloadly](https://sideloadly.io/) をインストール
3. iPhoneをUSBでPCにつなぎ、iPhone側で「このコンピュータを信頼」

### インストール

1. Sideloadlyを開き、`ARKTimer-unsigned.ipa` をドラッグ
2. **Apple ID** 欄に自分のApple IDを入力 → **Start**
   - パスワードを聞かれたら入力（2ファクタ認証のコードも）
   - 普段使いのIDが心配なら、サイドロード専用の無料Apple IDを作ってもOK
3. iPhoneでの設定
   - **設定 → 一般 → VPNとデバイス管理** → 自分のApple ID → **信頼**
   - iOS 16以降：**設定 → プライバシーとセキュリティ → デベロッパモード** をオン（再起動あり）
4. アプリを開き、通知の許可で **許可** を選ぶ

### 7日ごとの再署名について

無料Apple IDで署名したアプリは **7日で起動できなくなります**（データは残ります）。

- 期限が来たら、同じ手順でSideloadlyから入れ直すだけでOK（プリセットや実行中のタイマーは消えません）
- Sideloadlyの **Automatic Refresh**（ipaを入れるときの詳細オプション）を使うと、PCとiPhoneが同じWi-Fiにいる間に自動で再署名してくれます
- 無料IDの制限：同時にサイドロードできるアプリは3つまで

> 将来Apple Developer Program（有料）に入れば、1年有効・TestFlight配信にできます。その場合はワークフローに署名手順を追加します。

---

## 使い方

- **名前＋時間 → 開始**：タイマーがスタート
- **プリセット保存**：いまの名前と時間をプリセットに保存。プリセットをタップするとワンタップで開始
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
- 画面を変えたら push するだけで両OS分が再ビルドされます
- iOSの通知はOSに予約（最大64件）、Windowsはメインプロセスが1秒ごとに監視しています
