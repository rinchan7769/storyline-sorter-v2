# 家計簿アプリ (budget-app)

PDF明細・レシート画像・手入力に対応した、個人・ファミリー向けの家計簿Webアプリ。
固定費 / 変動費 / 特別費の可視化と、入力負荷の最小化を目指しています。

## 技術スタック
Next.js (App Router) / Tailwind CSS v4 / Recharts / Lucide / SQLite (better-sqlite3 + Drizzle ORM) / pdf-parse / zod / Vitest

## 起動
```bash
cd budget-app
npm install
npm run dev        # http://localhost:3000
npm test           # ユニットテスト
npm run build && npm start
```
DBは初回アクセス時に `data/budget.db` を自動作成し、カテゴリ・自動分類ルール・既定予算(30万円)を投入します(マイグレーション不要)。
`.env.example` を `.env.local` にコピーして設定できます。

| 変数 | 説明 |
|---|---|
| `ANTHROPIC_API_KEY` | 設定するとレシート画像をLLMビジョンで自動抽出。未設定時はサンプル値を返すモック抽出器(確認画面に警告表示) |
| `ANTHROPIC_MODEL` | 使用モデル(既定 `claude-sonnet-5-5`) |
| `DATABASE_PATH` | SQLiteファイルのパス |

## 画面
- `/dashboard` 月次サマリー(総支出・前月同期比・残予算「あと○○円」)、固定/変動/特別の構成比、カテゴリ別円グラフ(クリックで店舗別内訳へドリルダウン)、日別バー、累計の前月比較、カテゴリ別予算
- `/transactions` クイック入力(`n` 金額へ / `Ctrl/⌘+Enter` 保存 / `/` 検索)、月・期間・大分類・カテゴリ・支払元・キーワードの絞り込み、セル単位のインライン編集
- `/import` PDF・レシート画像のドラッグ&ドロップ。**必ず解析結果の確認画面を挟み**、修正してから登録
- `/settings` 月間予算(総額・カテゴリ別)、カテゴリ追加削除、自動分類ルール管理

## 設計メモ
- **カテゴリ**: `categories.kind` が大分類(固定費/変動費/特別費)、行が中分類。
- **自動分類** (`lib/categorize.ts`): キーワード部分一致(NFKC正規化)。優先順位は 手動 > 学習 > 組み込み、同順位は長いキーワード優先。短い英字(au, jr 等)は単語境界一致で誤爆防止。カテゴリを手修正すると店舗名が「学習」ルールとして自動登録されます。
- **重複取り込み防止** (`lib/dedupe.ts`): 行ハッシュ(日付|金額|店舗|支払方法|同一内容の出現順)に一意制約。同一ファイル内の同日同額の正当な複数行は保持し、再取り込み時は全てスキップ。ファイルのSHA-1も履歴に保存し、取込済みファイルを警告。レシート画像は画像ごとに別物として扱います。
- **PDF解析** (`lib/parsers/statement.ts`): 行頭の日付(`YYYY/MM/DD`・`M/D`・`YYYY年M月D日`)+末尾の金額をヒューリスティックに抽出。残高/合計行・入金・返金は除外し、金額列が複数ある行(銀行明細)は「要確認」表示。フォント非埋め込みの日本語PDFも読めるよう pdfjs の CMap を参照。
- **レシート抽出** (`lib/parsers/receipt.ts`): `ReceiptExtractor` インターフェース。別OCR/LLMへの差し替えは `getReceiptExtractor()` のみ。

## 制限事項
- スキャン画像のみのPDF(OCR)は未対応。カード会社ごとの明細レイアウト差は確認画面での修正が前提です。
- 認証なし・単一ユーザー前提(ローカル運用)。

## 外出先・iPhoneで使う(デプロイ)
認証は単一パスワード(HMAC署名Cookie、30日有効、同一IP 5回失敗で15分ロック)。
`NODE_ENV=production` で `APP_PASSWORD` が未設定の場合は **全アクセスを拒否(503)** します。

### 方法A: Docker + Tailscale(おすすめ・公開しない)
自宅PC/ミニPC/VPSでアプリを動かし、Tailscale(無料)で自分の端末同士だけをつなぎます。インターネットには公開されません。
```bash
cd budget-app
export APP_PASSWORD='長めのパスワード' AUTH_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE=false docker compose up -d --build   # http(Tailscale内)で使うため
```
サーバーとiPhoneにTailscaleを入れ、iPhoneのSafariで `http://<サーバーのTailscale名>:3000` を開きます。
`tailscale serve --bg 3000` を使えば `https://…ts.net` になり、その場合は `COOKIE_SECURE` の指定は不要です。

### 方法B: VPS + HTTPS で公開
CaddyなどでHTTPS化し、`localhost:3000` にリバースプロキシします(`COOKIE_SECURE` は既定の true のまま)。
```
budget.example.com {
  reverse_proxy localhost:3000
}
```
必ず強いパスワードを設定してください。DBは Docker ボリューム `budget-data`(`/data/budget.db`)に保存されるので、定期的にバックアップしてください。
(SQLiteファイルを使うため、Vercel等のサーバーレス環境には置けません。)

### iPhoneのホーム画面に追加
SafariでURLを開く → 共有ボタン → 「ホーム画面に追加」。アプリのように全画面で起動します。
レシート撮影は 取り込み画面 → レシートのドロップ枠をタップ → 「写真を撮る」で行えます。
