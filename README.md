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

## テスト

```bash
python test_fetch_pixiv_trends.py
```

pixiv には接続せず、ローカルのモック HTTP サーバ相手に
「タグ抽出 → グラフ抽出 → CSV 出力」を通しで検証する(404・グラフ無しのスキップ動作を含む)。

> **補足**: 百科事典側の HTML 構造が変わってグラフが読めなくなった場合は、
> `fetch_pixiv_trends.py` の `_series_from_data_attributes()` の属性名リストと
> `_JSON_KEY_RE` のキー名を実ページに合わせて追加すればよい。
