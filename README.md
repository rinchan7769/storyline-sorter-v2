# Storyline Sorter (PWA)

AIイラスト集の**画像選別・構成**を行うツール。スマホで並び順を決め、PC側で連番リネーム+JPG統一出力してモザイク工程へ渡す。

## ファイル

| ファイル | 役割 |
|---|---|
| `index.html` | アプリ本体(単一ファイル) |
| `manifest.json` | PWA定義(ホーム画面インストール用) |
| `sw.js` | Service Worker(オフライン動作) |
| `icon-192.png` / `icon-512.png` / `icon-512-maskable.png` | アイコン |
| `apply_order.py` | PC側で order.json を適用するスクリプト(このフォルダに同梱しなくても可) |
| `fetch_pixiv_trends.py` | pixiv トレンド収集ツール(CLI) — 下記参照 |
| `web_app.py` / `web/index.html` | 同ツールをブラウザから操作するためのローカル Web UI |

## GitHub Pages へのデプロイ手順

`rinchan7769` アカウントでの手順。**私(Claude)はリポジトリへの push やページ公開設定の変更は行いません。以下はあなた自身の操作です。**

### 方法A: ブラウザだけで完結(推奨・最短)

1. GitHub で新規リポジトリを作成(例: `storyline-sorter`、Public)
2. リポジトリ画面の「Add file → Upload files」で、この `pwa/` フォルダ内の全ファイル（`index.html` / `manifest.json` / `sw.js` / アイコン3つ）をドラッグ&ドロップ
3. Commit changes
4. 「Settings → Pages」を開く
5. Source を「Deploy from a branch」、Branch を `main` / `/ (root)` に設定して Save
6. 数分後 `https://rinchan7769.github.io/storyline-sorter/` で公開

### 方法B: git コマンド

```bash
git init
git add .
git commit -m "Storyline Sorter PWA"
git branch -M main
git remote add origin https://github.com/rinchan7769/storyline-sorter.git
git push -u origin main
# その後 Settings → Pages で main / root を公開設定
```

## スマホへのインストール

公開URLをスマホのブラウザで開く →
- **iOS Safari**: 共有 → 「ホーム画面に追加」
- **Android Chrome**: メニュー → 「アプリをインストール」

インストール後はオフラインでも起動でき、フルスクリーンで動作する。

## 使い方(サイクル)

1. PCで生成した画像をスマホへ転送 → アプリで「＋ 画像追加」
2. **選択して挿入 / ドラッグ**で構成を決める、不要はボツへ
3. 「order.json 出力」でファイルを取得、PCへ戻す
4. PCで `python apply_order.py <元フォルダ> order.json` → `output/001.jpg...` 生成
5. output をモザイク工程へ

## 注意

- 選別完了まで**元画像のファイル名は変更しない**(apply_order.py がファイル名で突合するため)
- サムネとフル画像を IndexedDB に保持するため、数百枚規模では端末の空き容量に注意

---

# pixiv トレンド収集ツール (`fetch_pixiv_trends.py`)

ピクシブ百科事典 / pixiv から**いま注目されている作品・キャラクタータグ**を自動抽出し、
各タグの**日別閲覧数推移**を 1 本の CSV にまとめるスクリプト。ネタ選びの参考用。

## セットアップ

```bash
pip install -r requirements.txt   # requests / beautifulsoup4 / pandas
```

ブラウザで操作したい場合は「[ブラウザで使う](#ブラウザで使う-web_apppy)」へ。
以下はコマンドラインでの使い方。

## 使い方

```bash
python fetch_pixiv_trends.py                        # トレンド上位20タグ → pixiv_trend_views.csv
python fetch_pixiv_trends.py --limit 50             # 取得タグ数を変える
python fetch_pixiv_trends.py --list-tags-only       # タグ抽出だけ確認(記事は開かない)
python fetch_pixiv_trends.py --tags 初音ミク ずんだもん  # タグを直接指定
python fetch_pixiv_trends.py --tag-file tags.txt    # 1行1タグのファイルから読む
python fetch_pixiv_trends.py -o out.csv -v          # 出力先変更 + 詳細ログ
```

主なオプション: `--no-ranking`(pixiv ランキングを使わない) / `--ranking-pages` /
`--sleep`(リクエスト間隔・延長のみ) / `--timeout` / `--max-retries` / `--dic-path`(一覧ページ追加)。

## 処理の流れ

1. **トレンドタグ抽出** — ピクシブ百科事典トップ (`https://dic.pixiv.net/`) の記事リンク
   (`/a/<タグ名>`) と、pixiv デイリーランキング JSON のタグ頻度から候補を集める。
   ヘルプ・カテゴリ・「〜一覧」・`R-18`・`オリジナル` 等のシステム/汎用タグは除外。
2. **閲覧推移の抽出** — `https://dic.pixiv.net/a/<タグ名>` を開き、
   `data-views` 属性、または `<script>` 内の埋め込み JSON からグラフデータを取り出す。
   chart.js 形式(`labels` + `datasets[].data`)、`[{date, views}, ...]`、
   `{"2026-08-01": 1234}`、`[[日付, 閲覧数], ...]` のいずれの形でも読める。
3. **CSV 出力** — 全タグ分を結合し、`pixiv_trend_views.csv` を **UTF-8 (BOM付き)** で保存。
   Excel でそのまま開ける。

出力カラム:

| カラム | 内容 |
|---|---|
| `tag_name` | タグ名 |
| `date` | 日付 (`YYYY-MM-DD`) |
| `views` | その日の閲覧数 |
| `article_url` | 取得元の記事 URL |

## マナーとエラー処理

- pixiv 系ホストへのリクエストは**必ず 2 秒以上の間隔**を空ける(`--sleep` は延長のみ可能)。
- ブラウザ相当の User-Agent / Accept-Language を送信。
- 存在しないタグ(404)、閲覧グラフの無い記事、解析失敗は**警告ログを出してスキップ**し、
  残りのタグの処理は続行する。通信エラーは指数バックオフで再試行する。
- 取得データの利用は pixiv の利用規約の範囲内で。

## ブラウザで使う (`web_app.py`)

コマンドライン操作なしで使いたい場合はこちら。

```bash
python web_app.py          # → http://127.0.0.1:8765 が自動で開く
```

ブラウザ上で **取得設定 → 実行 → 進捗ログ → 表とグラフ → CSV ダウンロード** まで完結する。

| できること | 説明 |
|---|---|
| 取得設定 | タグ数の上限・リクエスト間隔・ランキング利用の有無、タグの直接指定 |
| 進捗表示 | 何タグ目を取得中かのバーと、スキップ理由を含むライブログ |
| 中止 | 実行中のジョブを途中で止める(そこまでの結果は残る) |
| 一覧表 | タグごとの合計 / 最新日 / 増減率 / 日数 + 行内スパークライン、列ソート対応 |
| 比較グラフ | 選んだタグ(最大 8 件)の推移を重ねて表示。ホバーで十字線とツールチップ |
| CSV | その場でダウンロード。既存の CSV を読み込んで表示だけすることも可能 |

起動オプション: `--lan` / `--port` / `--host` / `--no-browser` / `-v`。

### iPhone / Android から使う

スマホ単体では動かない(Python が必要)。**PC でサーバを立てて、スマホのブラウザから操作する**。

```bash
python web_app.py --lan
```

起動時に表示される `http://192.168.x.x:8765/` をスマホの Safari / Chrome で開く
(PC とスマホが同じ Wi-Fi にいること)。画面はスマホ幅に対応していて、
Safari の「共有 → ホーム画面に追加」でアプリのように開ける。
グラフは指でタップ/ドラッグすると、その日の数値が出る。

- 取得は PC 側で動くので、**スマホの画面を消しても取得は止まらない**。
  戻ってくれば続きから表示される。
- `--lan` は同じネットワークの誰でも開ける状態になる。自宅の Wi-Fi で使い、
  公共の Wi-Fi では使わないこと(既定は `127.0.0.1` のみでこの動作はしない)。
- ルータによっては IP が変わるので、ホーム画面に追加したアイコンが繋がらなく
  なったら、表示されている新しい IP で登録し直す。

### なぜローカルサーバが必要か

`dic.pixiv.net` は CORS ヘッダ (`Access-Control-Allow-Origin`) を返さないため、
**ブラウザの JavaScript から直接スクレイピングすることはできない**
(GitHub Pages に置いた静的ページからは必ずブロックされる)。
そのため「取得は Python 側、操作と表示はブラウザ側」という構成にしている。

なお `web_app.py` は標準ライブラリの `http.server` を使っているので、
**追加の pip install は不要**(`requirements.txt` の 3 つだけで動く)。
既定では `127.0.0.1` のみで待ち受け、スクレイピング先 URL はサーバ側の起動オプションでのみ
決まる(ブラウザから書き換えられない)。

## テスト

```bash
python test_fetch_pixiv_trends.py   # スクレイパ本体 (23 ケース)
python test_web_app.py              # ブラウザ UI のサーバ側 API (12 ケース)
```

いずれも pixiv には接続せず、ローカルのモック HTTP サーバ相手に
「タグ抽出 → グラフ抽出 → CSV 出力」を通しで検証する(404・グラフ無しのスキップ動作を含む)。

> **補足**: 百科事典側の HTML 構造が変わってグラフが読めなくなった場合は、
> `fetch_pixiv_trends.py` の `_series_from_data_attributes()` の属性名リストと
> `_JSON_KEY_RE` のキー名を実ページに合わせて追加すればよい。
