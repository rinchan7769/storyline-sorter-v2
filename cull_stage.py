#!/usr/bin/env python3
"""AI生成イラストの自動選別スクリプト（300〜500枚 -> 100枚）

使い方:
  python cull_stage.py <入力フォルダ> <出力フォルダ> [--prefs <好み画像フォルダ>]

パイプライン:
  1. ぼやけ検出 (Laplacian分散) で足切り
  2. pHash + CLIP(ViT-L-14)コサイン類似度で重複除去（高スコア側を残す）
  3. LAION aesthetic predictor + 好み画像の平均埋め込みとの類似度で採点
  4. WD14タガー(wd-swinv2-tagger-v3)で NGタグ除外 + シチュエーション分類
  5. 構成: 挿入 60枚 + 他5カテゴリ各8枚

出力:
  out/keep/01_グラビア .. 06_挿入 , out/maybe , out/要確認 , out/reject/{blur,dup,tag} , out/scores.csv
  元画像は移動せずコピーのみ。特徴量は out/.cache.pkl に保存されるので、
  閾値やタグを調整した再実行は高速です（--no-cache で無効化）。

初回はモデルを自動ダウンロードします（CLIP ViT-L-14 約1.7GB、WD14 約0.5GB、aesthetic 数MB）。

【調整ポイント】 誤分類が多い場合はこのファイル冒頭の ACTION_TAGS / NG_TAGS、
  および --act-thr を調整してください。scores.csv の top_tags が手掛かりになります。
"""
import argparse
import csv
import pickle
import shutil
import sys
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------- 調整用設定
# カテゴリ -> {タグ: 重み}。画像のカテゴリスコア = max(タグ確率 * 重み)
ACTION_TAGS = {
    "フェラ": {
        "fellatio": 1.0, "deepthroat": 1.0, "irrumatio": 1.0, "oral": 0.9,
        "licking_penis": 1.0, "cum_in_mouth": 0.8, "penis_in_mouth": 1.0,
        "fellatio_gesture": 0.5, "multiple_fellatio": 1.0,
    },
    "パイズリ": {
        "paizuri": 1.0, "penis_between_breasts": 1.0, "breast_press_penis": 0.9,
        "paizuri_over_clothes": 1.0, "paizuri_under_clothes": 1.0,
    },
    "手コキ": {
        "handjob": 1.0, "multiple_handjob": 1.0, "grabbing_another's_penis": 0.8,
        "reach-around": 0.7,
    },
    "クンニ": {
        "cunnilingus": 1.0, "licking_pussy": 1.0, "tongue_on_pussy": 1.0,
        "oral_pussy": 0.8,
    },
    "挿入": {
        "sex": 0.9, "vaginal": 1.0, "anal": 1.0, "penetration": 1.0,
        "sex_from_behind": 1.0, "missionary": 1.0, "cowgirl_position": 1.0,
        "reverse_cowgirl_position": 1.0, "girl_on_top": 0.9, "doggystyle": 1.0,
        "mating_press": 1.0, "prone_bone": 1.0, "standing_sex": 1.0,
        "spooning": 0.9, "cum_in_pussy": 0.9, "clothed_sex": 1.0,
        "top-down_bottom-up": 0.9, "suspended_congress": 1.0,
    },
}
# グラビア: 行為タグが無く、solo かつ以下のタグがある画像
GRAVURE_TAGS = {
    "bikini": 1.0, "swimsuit": 0.9, "micro_bikini": 1.0, "string_bikini": 1.0,
    "lingerie": 0.9, "underwear": 0.8, "bra": 0.7, "panties": 0.6,
    "cleavage": 0.6, "navel": 0.4, "thighs": 0.4, "underboob": 0.7,
    "sideboob": 0.7, "see-through": 0.6, "naked_towel": 0.8, "wet": 0.4,
    "leotard": 0.6, "sportswear": 0.5, "gym_uniform": 0.5,
}
GRAVURE_REQUIRE = ["solo"]                      # 全て必要
GRAVURE_FORBID = ["1boy", "2boys", "multiple_boys", "penis", "hetero", "sex"]  # 1つでもあれば不可
GRAVURE_MIN_SCORE = 0.5  # グラビア判定の最低スコア（--grav-thr で上書き）

# 除外タグ: {タグ: 閾値}
NG_TAGS = {
    "text": 0.5, "english_text": 0.5, "chinese_text": 0.5, "korean_text": 0.5,
    "japanese_text": 0.5, "watermark": 0.4, "signature": 0.5, "artist_name": 0.5,
    "web_address": 0.4, "username": 0.5, "logo": 0.6, "copyright_name": 0.6,
    "monochrome": 0.5, "greyscale": 0.5, "comic": 0.6, "speech_bubble": 0.6,
    "bad_hands": 0.4, "bad_anatomy": 0.4, "extra_digits": 0.5, "fewer_digits": 0.5,
    "missing_fingers": 0.5, "extra_fingers": 0.5, "mutated_hands": 0.4,
    "mutated_hands_and_fingers": 0.4, "bad_feet": 0.5, "extra_arms": 0.5,
    "extra_legs": 0.5, "fused_fingers": 0.5,
}
# 美的スコア合算の重み
PREF_WEIGHT = 0.5   # 好み類似度（0..1に正規化）の重み。aesthetic(0..1換算)に対する比率

# 構成
QUOTA = {"挿入": 60, "グラビア": 8, "フェラ": 8, "パイズリ": 8, "手コキ": 8, "クンニ": 8}
KEEP_DIRS = {"グラビア": "01_グラビア", "フェラ": "02_フェラ", "パイズリ": "03_パイズリ",
             "手コキ": "04_手コキ", "クンニ": "05_クンニ", "挿入": "06_挿入"}

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
AESTHETIC_URL = ("https://github.com/LAION-AI/aesthetic-predictor/raw/main/"
                 "sa_0_4_vit_l_14_linear.pth")
WD_REPO = "SmilingWolf/wd-swinv2-tagger-v3"


# ---------------------------------------------------------------- 純ロジック（モデル不要）
def classify(tag_probs, act_thr, grav_thr, amb_margin):
    """tag_probs: {tag: prob} -> (category|None, score, ambiguous, scores_dict)"""
    scores = {}
    for cat, tags in ACTION_TAGS.items():
        best = 0.0
        for t, w in tags.items():
            best = max(best, tag_probs.get(t, 0.0) * w)
        scores[cat] = best
    # グラビア
    g = 0.0
    if all(tag_probs.get(t, 0.0) >= 0.5 for t in GRAVURE_REQUIRE) and \
            all(tag_probs.get(t, 0.0) < 0.3 for t in GRAVURE_FORBID):
        g = max((tag_probs.get(t, 0.0) * w for t, w in GRAVURE_TAGS.items()), default=0.0)
    scores["グラビア"] = g if g >= grav_thr else 0.0
    # 行為が出ていればグラビアは不採用
    if any(scores[c] >= act_thr for c in ACTION_TAGS):
        scores["グラビア"] = 0.0

    thr = {c: (act_thr if c in ACTION_TAGS else grav_thr) for c in scores}
    cand = {c: s for c, s in scores.items() if s >= thr[c]}
    if not cand:
        return None, 0.0, False, scores
    # 挿入タグ("sex"等)は他の行為と同時に出やすいので、特定行為を優先
    adj = {c: s * (0.9 if c == "挿入" else 1.0) for c, s in cand.items()}
    ranked = sorted(adj.items(), key=lambda kv: kv[1], reverse=True)
    best, bs = ranked[0]
    ambiguous = len(ranked) > 1 and (bs - ranked[1][1]) < amb_margin
    return best, scores[best], ambiguous, scores


def ng_reasons(tag_probs):
    return [t for t, thr in NG_TAGS.items() if tag_probs.get(t, 0.0) >= thr]


def select(records, quota):
    """分類済み・生存レコードをカテゴリ別に上位quota件keep、残りmaybeにする。"""
    short = {}
    for cat, n in quota.items():
        items = sorted((r for r in records if r["status"] == "pending" and r["category"] == cat),
                       key=lambda r: r["final"], reverse=True)
        for i, r in enumerate(items):
            r["status"] = "keep" if i < n else "maybe"
        short[cat] = max(0, n - len(items))
    return short


# ---------------------------------------------------------------- 特徴量
def collect(inp: Path, out: Path):
    out_r = out.resolve()
    files = []
    for p in sorted(inp.rglob("*")):
        if p.suffix.lower() in EXTS and p.is_file():
            try:
                p.resolve().relative_to(out_r)
                continue  # 出力フォルダ内は対象外
            except ValueError:
                files.append(p)
    return files


def blur_score(img):
    import cv2
    import numpy as np
    a = np.array(img.convert("L"))
    h, w = a.shape
    s = 1024 / max(h, w)
    if s < 1:
        a = cv2.resize(a, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(a, cv2.CV_64F).var())


def load_cache(path, use):
    if use and path.exists():
        try:
            return pickle.loads(path.read_bytes())
        except Exception:
            pass
    return {}


def key_of(p: Path):
    st = p.stat()
    return (str(p), st.st_mtime_ns, st.st_size)


class Clip:
    def __init__(self, device):
        import open_clip
        import torch
        self.torch, self.device = torch, device
        print("[CLIP] ViT-L-14 をロード（初回は約1.7GBダウンロード）...")
        self.model, _, self.pre = open_clip.create_model_and_transforms(
            "ViT-L-14", pretrained="openai", device=device)
        self.model.eval()
        self.aes = self._load_aesthetic()

    def _load_aesthetic(self):
        torch = self.torch
        dst = Path.home() / ".cache" / "cull_stage" / "sa_0_4_vit_l_14_linear.pth"
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists():
            print("[AES] aesthetic predictor をダウンロード...")
            try:
                urllib.request.urlretrieve(AESTHETIC_URL, dst)
            except Exception as e:
                print(f"[AES] 取得失敗: {e}\n      美的スコアは0扱い（手動で {dst} に配置すれば有効）")
                return None
        lin = torch.nn.Linear(768, 1)
        lin.load_state_dict(torch.load(dst, map_location="cpu", weights_only=True))
        return lin.to(self.device).eval()

    def embed(self, img):
        torch = self.torch
        x = self.pre(img).unsqueeze(0).to(self.device)
        with torch.no_grad():
            f = self.model.encode_image(x).float()
            f = f / f.norm(dim=-1, keepdim=True)
            aes = float(self.aes(f).item()) if self.aes is not None else 0.0
        return f[0].cpu().numpy(), aes


class Tagger:
    def __init__(self, cpu):
        import numpy as np
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        print("[WD14] タガーをロード（初回は約0.5GBダウンロード）...")
        model = hf_hub_download(WD_REPO, "model.onnx")
        tags = hf_hub_download(WD_REPO, "selected_tags.csv")
        with open(tags, encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        self.names = [r["name"] for r in rows]
        self.cats = np.array([int(r["category"]) for r in rows])
        self.np = np
        self.sess = None
        provs = ["CPUExecutionProvider"]
        if not cpu and "CUDAExecutionProvider" in ort.get_available_providers():
            provs = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        for pv in (provs, ["CPUExecutionProvider"]):
            try:
                s = ort.InferenceSession(model, providers=pv)
                self.inp = s.get_inputs()[0]
                self.size = self.inp.shape[1]
                s.run(None, {self.inp.name: np.zeros((1, self.size, self.size, 3), np.float32)})
                self.sess = s
                print(f"[WD14] 実行プロバイダ: {s.get_providers()[0]}")
                break
            except Exception as e:
                print(f"[WD14] {pv[0]} で失敗 ({str(e)[:120]}) -> CPUにフォールバック")
        if self.sess is None:
            sys.exit("WD14 の初期化に失敗しました")

    def predict(self, img):
        np = self.np
        from PIL import Image
        w, h = img.size
        m = max(w, h)
        canvas = Image.new("RGB", (m, m), (255, 255, 255))
        canvas.paste(img, ((m - w) // 2, (m - h) // 2))
        canvas = canvas.resize((self.size, self.size), Image.BICUBIC)
        a = np.asarray(canvas, dtype=np.float32)[:, :, ::-1]  # BGR, 0-255
        p = self.sess.run(None, {self.inp.name: a[None]})[0][0]
        return p.astype(np.float16)

    def to_dict(self, probs):
        # general(0)とcharacter(4)のみ。rating(9)は除外。
        return {n: float(p) for n, p, c in zip(self.names, probs, self.cats) if c in (0, 4)}

    def top_general(self, probs, k=8):
        np = self.np
        idx = np.where(self.cats == 0)[0]
        top = idx[np.argsort(-probs[idx].astype(np.float32))[:k]]
        return " ".join(f"{self.names[i]}:{float(probs[i]):.2f}" for i in top)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--prefs", type=Path, default=None, help="好み画像フォルダ（任意）")
    ap.add_argument("--blur-thr", type=float, default=30.0, help="Laplacian分散がこれ未満はぼやけ判定")
    ap.add_argument("--clip-dup", type=float, default=0.93, help="CLIPコサイン類似度の重複閾値")
    ap.add_argument("--phash-dist", type=int, default=4, help="pHashハミング距離の重複閾値")
    ap.add_argument("--act-thr", type=float, default=0.35, help="行為タグの採用閾値")
    ap.add_argument("--grav-thr", type=float, default=GRAVURE_MIN_SCORE, help="グラビア判定の閾値")
    ap.add_argument("--amb-margin", type=float, default=0.08, help="1位と2位の差がこれ未満なら要確認")
    ap.add_argument("--pref-weight", type=float, default=PREF_WEIGHT)
    ap.add_argument("--cpu", action="store_true", help="onnxruntimeをCPUで実行")
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()

    from PIL import Image
    import numpy as np
    import imagehash

    inp, out = args.input, args.output
    if not inp.is_dir():
        sys.exit(f"入力フォルダが見つかりません: {inp}")
    out.mkdir(parents=True, exist_ok=True)
    files = collect(inp, out)
    if not files:
        sys.exit("画像が見つかりません")
    print(f"対象画像: {len(files)}枚")

    cache_path = out / ".cache.pkl"
    cache = load_cache(cache_path, not args.no_cache)

    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[torch] {torch.__version__} device={device}")
    clip = Clip(device)

    def open_rgb(p):
        im = Image.open(p)
        im.load()
        return im.convert("RGB")

    # ---- 好み画像
    pref_vec = None
    if args.prefs:
        pfiles = [p for p in args.prefs.rglob("*") if p.suffix.lower() in EXTS]
        embs = []
        for p in pfiles:
            k = key_of(p)
            c = cache.get(("pref",) + k)
            if c is None:
                try:
                    c = clip.embed(open_rgb(p))[0]
                except Exception as e:
                    print(f"  好み画像スキップ {p.name}: {e}")
                    continue
                cache[("pref",) + k] = c
            embs.append(c)
        if embs:
            pref_vec = np.mean(embs, axis=0)
            pref_vec /= np.linalg.norm(pref_vec)
            print(f"[好み] {len(embs)}枚の平均埋め込みを使用")
        else:
            print("[好み] 画像が見つからないためスキップ")

    # ---- 1,2,3: ぼやけ / CLIP / aesthetic / pHash
    recs = []
    for i, p in enumerate(files, 1):
        k = key_of(p)
        c = cache.get(k)
        if c is None:
            try:
                im = open_rgb(p)
            except Exception as e:
                print(f"  読み込み失敗 {p.name}: {e}")
                recs.append({"path": p, "status": "reject", "reason": "unreadable", "sub": "blur",
                             "category": "", "blur": 0, "aes": 0, "pref": 0, "final": 0,
                             "cls": 0, "tags": "", "dup_of": ""})
                continue
            emb, aes = clip.embed(im)
            c = {"blur": blur_score(im), "emb": emb, "aes": aes, "phash": str(imagehash.phash(im))}
            cache[k] = c
        if i % 25 == 0 or i == len(files):
            print(f"  特徴量 {i}/{len(files)}")
        pref = float(c["emb"] @ pref_vec) if pref_vec is not None else 0.0
        recs.append({"path": p, "key": k, "status": "pending", "reason": "", "sub": "", "category": "",
                     "blur": c["blur"], "aes": c["aes"], "pref": pref, "emb": c["emb"],
                     "phash": imagehash.hex_to_hash(c["phash"]), "final": 0.0, "cls": 0.0,
                     "tags": "", "dup_of": ""})
    cache_path.write_bytes(pickle.dumps(cache))

    live = [r for r in recs if r["status"] == "pending"]
    # 最終スコア: aesthetic(約0..10)/10 + pref_weight * 好み類似度(集合内min-maxで0..1)
    if pref_vec is not None and live:
        ps = np.array([r["pref"] for r in live])
        lo, hi = ps.min(), ps.max()
        for r in live:
            r["pref_n"] = (r["pref"] - lo) / (hi - lo) if hi > lo else 0.0
    for r in live:
        r["final"] = r["aes"] / 10.0 + args.pref_weight * r.get("pref_n", 0.0)

    # ---- 1: ぼやけ
    for r in live:
        if r["blur"] < args.blur_thr:
            r.update(status="reject", reason=f"blur({r['blur']:.0f})", sub="blur")
    live = [r for r in live if r["status"] == "pending"]

    # ---- 2: 重複（高スコア順に貪欲）
    live.sort(key=lambda r: r["final"], reverse=True)
    kept = []
    for r in live:
        dup = None
        for q in kept:
            sim = float(r["emb"] @ q["emb"])
            if sim >= args.clip_dup or (r["phash"] - q["phash"]) <= args.phash_dist:
                dup = q
                break
        if dup:
            r.update(status="reject", reason="duplicate", sub="dup", dup_of=dup["path"].name)
        else:
            kept.append(r)
    live = kept
    print(f"[重複/ぼやけ後] 生存 {len(live)}枚")

    # ---- 4: WD14
    tagger = Tagger(args.cpu)
    dirty = False
    for i, r in enumerate(live, 1):
        c = cache[r["key"]]
        if "tags" not in c:
            c["tags"] = tagger.predict(open_rgb(r["path"]))
            dirty = True
        probs = c["tags"]
        d = tagger.to_dict(probs)
        r["tags"] = tagger.top_general(probs)
        ng = ng_reasons(d)
        if ng:
            r.update(status="reject", reason="ng:" + ",".join(ng), sub="tag")
            continue
        cat, sc, amb, _ = classify(d, args.act_thr, args.grav_thr, args.amb_margin)
        r["cls"] = sc
        if cat is None:
            r.update(status="review", reason="unclassified")
        elif amb:
            r.update(status="review", reason=f"ambiguous({cat})", category=cat)
        else:
            r["category"] = cat
        if i % 25 == 0 or i == len(live):
            print(f"  タグ {i}/{len(live)}")
    if dirty:
        cache_path.write_bytes(pickle.dumps(cache))

    # ---- 構成
    short = select(recs, QUOTA)

    # ---- コピー
    for d in list(KEEP_DIRS.values()):
        (out / "keep" / d).mkdir(parents=True, exist_ok=True)
    for d in ("maybe", "要確認", "reject"):
        (out / d).mkdir(exist_ok=True)
    used = set()

    def dest_for(r):
        s = r["status"]
        if s == "keep":
            base = out / "keep" / KEEP_DIRS[r["category"]]
        elif s == "maybe":
            base = out / "maybe"
        elif s == "review":
            base = out / "要確認"
        else:
            base = out / "reject" / (r["sub"] or "other")
        base.mkdir(parents=True, exist_ok=True)
        name = r["path"].name
        n = 1
        while (base / name) in used or (base / name).exists():
            name = f"{r['path'].stem}_{n}{r['path'].suffix}"
            n += 1
        used.add(base / name)
        return base / name

    for r in recs:
        shutil.copy2(r["path"], dest_for(r))

    with open(out / "scores.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["file", "status", "category", "reason", "blur", "aesthetic", "pref_sim",
                    "final", "cls_score", "dup_of", "top_tags"])
        for r in sorted(recs, key=lambda r: (r["status"], r["category"], -r["final"])):
            w.writerow([r["path"].name, r["status"], r["category"], r["reason"], f"{r['blur']:.1f}",
                        f"{r['aes']:.2f}", f"{r['pref']:.3f}", f"{r['final']:.3f}", f"{r['cls']:.2f}",
                        r["dup_of"], r["tags"]])

    # ---- 報告
    print("\n===== 結果 =====")
    total = 0
    for cat in ("グラビア", "フェラ", "パイズリ", "手コキ", "クンニ", "挿入"):
        n = sum(1 for r in recs if r["status"] == "keep" and r["category"] == cat)
        total += n
        extra = f"  (不足 {short[cat]}枚)" if short[cat] else ""
        print(f"  keep/{KEEP_DIRS[cat]}: {n}/{QUOTA[cat]}{extra}")
    cnt = lambda s: sum(1 for r in recs if r["status"] == s)
    print(f"  keep合計: {total}")
    print(f"  maybe: {cnt('maybe')}  要確認: {cnt('review')}  reject: {cnt('reject')}")
    for sub in ("blur", "dup", "tag"):
        print(f"    reject/{sub}: {sum(1 for r in recs if r['status']=='reject' and r['sub']==sub)}")
    print(f"scores.csv: {out / 'scores.csv'}")
    miss = [c for c, n in short.items() if n]
    if miss:
        print("不足カテゴリ:", ", ".join(f"{c}(-{short[c]})" for c in miss),
              "→ maybe/要確認 から手動補充、または --act-thr / ACTION_TAGS を調整して再実行")


if __name__ == "__main__":
    main()
