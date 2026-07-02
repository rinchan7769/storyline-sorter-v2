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
