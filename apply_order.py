# -*- coding: utf-8 -*-
"""
apply_order.py — Storyline Sorter (PWA) の order.json をPC側で適用するスクリプト

スマホのPWAで決めた並び順(order.json)を元に、
元画像フォルダから 001.jpg, 002.jpg ... へ連番リネーム+JPG統一出力する。
ボツ画像は botsu/ フォルダへ隔離コピーする。

使い方:
    python apply_order.py <元画像フォルダ> <order.json> [出力フォルダ]

例:
    python apply_order.py D:\\gen\\20260702 D:\\Downloads\\order.json
    → D:\\gen\\20260702\\output\\001.jpg ... が生成される
"""

import sys
import json
import shutil
from pathlib import Path

from PIL import Image

JPG_QUALITY = 95


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    src_dir = Path(sys.argv[1])
    order_path = Path(sys.argv[2])
    out_dir = Path(sys.argv[3]) if len(sys.argv) >= 4 else src_dir / "output"
    botsu_dir = out_dir.parent / "botsu"

    if not src_dir.is_dir():
        print(f"[ERROR] 元フォルダが見つかりません: {src_dir}")
        sys.exit(1)
    if not order_path.is_file():
        print(f"[ERROR] order.json が見つかりません: {order_path}")
        sys.exit(1)

    with open(order_path, encoding="utf-8") as f:
        data = json.load(f)

    order = data.get("order", [])
    botsu = data.get("botsu", [])

    # 元フォルダのファイルを名前で索引化(サブフォルダも検索)
    index = {}
    for p in src_dir.rglob("*"):
        if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
            index.setdefault(p.name, p)

    out_dir.mkdir(parents=True, exist_ok=True)

    # ---- 採用: 連番リネーム + JPG統一 ----
    ok, missing = 0, []
    for i, name in enumerate(order, start=1):
        src = index.get(name)
        if src is None:
            missing.append(name)
            continue
        dst = out_dir / f"{i:03d}.jpg"
        try:
            with Image.open(src) as im:
                if im.mode in ("RGBA", "P", "LA"):
                    im = im.convert("RGB")
                im.save(dst, "JPEG", quality=JPG_QUALITY)
            ok += 1
            print(f"  {name}  ->  {dst.name}")
        except Exception as e:
            print(f"  [SKIP] {name}: {e}")

    # ---- ボツ: 隔離コピー ----
    b_ok = 0
    if botsu:
        botsu_dir.mkdir(parents=True, exist_ok=True)
        for name in botsu:
            src = index.get(name)
            if src is None:
                missing.append(name)
                continue
            shutil.copy2(src, botsu_dir / name)
            b_ok += 1

    print("-" * 50)
    print(f"採用: {ok}/{len(order)} 枚 -> {out_dir}")
    if botsu:
        print(f"ボツ: {b_ok}/{len(botsu)} 枚 -> {botsu_dir}")
    if missing:
        print(f"[WARN] 見つからなかったファイル {len(missing)} 件:")
        for m in missing:
            print(f"  - {m}")
    print("完了。output/ をモザイク処理工程へ渡してください。")


if __name__ == "__main__":
    main()
