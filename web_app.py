#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
web_app.py — fetch_pixiv_trends.py をブラウザから操作するためのローカル Web UI

    python web_app.py            # → http://127.0.0.1:8765 が自動で開く

なぜローカルサーバが必要か:
    dic.pixiv.net は CORS ヘッダ (Access-Control-Allow-Origin) を返さないため、
    ブラウザの JavaScript から直接スクレイピングすることはできない。
    そこで「取得は Python 側、操作と表示はブラウザ側」という構成にしている。

    追加の pip 依存はなし(標準ライブラリの http.server を使用)。
    fetch_pixiv_trends.py と同じ requests / beautifulsoup4 / pandas だけで動く。

API:
    GET  /                → UI (web/index.html)
    POST /api/run         → 取得ジョブ開始 {limit, sleep, tags, use_ranking, ranking_pages}
    GET  /api/status      → 進捗・ログ
    GET  /api/result      → タグごとの時系列データ (JSON)
    GET  /api/csv         → pixiv_trend_views.csv をダウンロード
    POST /api/cancel      → 実行中のジョブを中止

セキュリティ:
    既定で 127.0.0.1 のみで待ち受ける。スクレイピング先 URL はサーバ側の設定
    (起動オプション)でのみ決まり、ブラウザからは変更できない。
"""

from __future__ import annotations

import argparse
import json
import logging
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pandas as pd

import fetch_pixiv_trends as ft

UI_DIR = Path(__file__).resolve().parent / "web"
MAX_BODY_BYTES = 256 * 1024
MAX_LOG_LINES = 500

LOG = logging.getLogger("pixiv_trends.web")


# --------------------------------------------------------------------------------------
# ジョブ管理
# --------------------------------------------------------------------------------------


class _JobLogHandler(logging.Handler):
    """スクレイパのログをジョブへ溜め込み、ブラウザに流すためのハンドラ。"""

    def __init__(self, job: "Job") -> None:
        super().__init__(level=logging.INFO)
        self.job = job

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
        except Exception:  # ログ整形の失敗で取得処理を止めない
            return
        self.job.add_log(record.levelname, message)


class Job:
    """1 回分の取得処理。UI からは常に最新の 1 件だけを見る。"""

    def __init__(self, params: dict[str, Any]) -> None:
        self.params = params
        self.lock = threading.Lock()
        self.cancel_event = threading.Event()
        self.state = "running"          # running / done / cancelled / error
        self.logs: list[dict[str, Any]] = []
        self.log_seq = 0
        self.total = 0
        self.done = 0
        self.current = ""
        self.ok_tags: list[str] = []
        self.skipped_tags: list[str] = []
        self.frame: pd.DataFrame = ft.build_dataframe([])
        self.error = ""
        self.started_at = time.time()
        self.finished_at: float | None = None

    # -- 進捗の記録 -------------------------------------------------------------------

    def add_log(self, level: str, message: str) -> None:
        with self.lock:
            self.log_seq += 1
            self.logs.append({"seq": self.log_seq, "level": level, "message": message})
            if len(self.logs) > MAX_LOG_LINES:
                del self.logs[: len(self.logs) - MAX_LOG_LINES]

    def snapshot(self, since: int = 0) -> dict[str, Any]:
        with self.lock:
            return {
                "state": self.state,
                "total": self.total,
                "done": self.done,
                "current": self.current,
                "ok_count": len(self.ok_tags),
                "skipped": list(self.skipped_tags),
                "row_count": int(len(self.frame)),
                "error": self.error,
                "elapsed": round((self.finished_at or time.time()) - self.started_at, 1),
                "logs": [entry for entry in self.logs if entry["seq"] > since],
                "log_seq": self.log_seq,
            }

    # -- 本体 -------------------------------------------------------------------------

    def run(self, dic_base: str, ranking_url: str) -> None:
        handler = _JobLogHandler(self)
        ft.LOG.addHandler(handler)
        try:
            self._scrape(dic_base, ranking_url)
        except Exception as exc:  # UI に必ず理由を出す
            LOG.exception("取得処理が異常終了しました")
            with self.lock:
                self.state = "error"
                self.error = f"{type(exc).__name__}: {exc}"
            self.add_log("ERROR", f"処理が異常終了しました: {exc}")
        finally:
            ft.LOG.removeHandler(handler)
            with self.lock:
                if self.state == "running":
                    self.state = "cancelled" if self.cancel_event.is_set() else "done"
                self.finished_at = time.time()

    def _scrape(self, dic_base: str, ranking_url: str) -> None:
        params = self.params
        session = ft.PoliteSession(interval=params["sleep"], timeout=params["timeout"],
                                   max_retries=params["max_retries"])

        tags: list[str] = list(params["tags"])
        if tags:
            self.add_log("INFO", f"指定された {len(tags)} 件のタグを取得します")
        else:
            self.add_log("INFO", "トレンドタグを収集しています...")
            tags = ft.collect_trend_tags(
                session,
                dic_base=dic_base,
                ranking_url=ranking_url if params["use_ranking"] else None,
                dic_paths=ft.DEFAULT_DIC_PATHS,
                ranking_pages=params["ranking_pages"],
                limit=params["limit"],
            )

        if self.cancel_event.is_set():
            self.add_log("WARNING", "中止されました")
            return
        if not tags:
            self.add_log("ERROR", "対象タグを 1 件も抽出できませんでした")
            return

        with self.lock:
            self.total = len(tags)
        self.add_log("INFO", f"対象タグ ({len(tags)} 件): {', '.join(tags)}")

        frames: list[pd.DataFrame] = []
        for index, tag in enumerate(tags, start=1):
            if self.cancel_event.is_set():
                self.add_log("WARNING", f"中止されました ({index - 1}/{len(tags)} 件まで取得済み)")
                break
            with self.lock:
                self.current = tag
            self.add_log("INFO", f"({index}/{len(tags)}) {tag} の閲覧データを取得中...")

            frame = ft.fetch_tag_series(session, dic_base, tag)
            with self.lock:
                self.done = index
                if frame is None or frame.empty:
                    self.skipped_tags.append(tag)
                else:
                    frames.append(frame)
                    self.ok_tags.append(tag)
                    self.frame = ft.build_dataframe(frames)

        with self.lock:
            self.current = ""
            self.frame = ft.build_dataframe(frames)
        self.add_log("INFO",
                     f"完了: 成功 {len(self.ok_tags)} タグ / スキップ {len(self.skipped_tags)} タグ "
                     f"/ {len(self.frame)} 行")

    # -- 結果 -------------------------------------------------------------------------

    def result_payload(self) -> dict[str, Any]:
        with self.lock:
            frame = self.frame.copy()
        series = []
        for tag, group in frame.groupby("tag_name", sort=False):
            group = group.sort_values("date")
            series.append({
                "tag": tag,
                "url": str(group["article_url"].iloc[0]),
                "points": [[str(row.date), int(row.views)] for row in group.itertuples()],
            })
        series.sort(key=lambda item: -sum(point[1] for point in item["points"]))
        return {"series": series, "row_count": int(len(frame))}

    def csv_bytes(self) -> bytes:
        with self.lock:
            frame = self.frame.copy()
        return frame.to_csv(index=False).encode("utf-8-sig")


class JobRunner:
    """同時に 1 ジョブだけ走らせる、ごく単純なランナー。"""

    def __init__(self, dic_base: str, ranking_url: str) -> None:
        self.dic_base = dic_base
        self.ranking_url = ranking_url
        self.job: Job | None = None
        self._lock = threading.Lock()

    @property
    def is_running(self) -> bool:
        return self.job is not None and self.job.state == "running"

    def start(self, params: dict[str, Any]) -> Job:
        with self._lock:
            if self.is_running:
                raise RuntimeError("すでに取得処理が実行中です")
            job = Job(params)
            self.job = job
        threading.Thread(target=job.run, args=(self.dic_base, self.ranking_url),
                         daemon=True).start()
        return job

    def cancel(self) -> bool:
        job = self.job
        if job is None or job.state != "running":
            return False
        job.cancel_event.set()
        job.add_log("WARNING", "中止を要求しました(現在のリクエスト完了後に停止します)")
        return True


# --------------------------------------------------------------------------------------
# リクエストのパラメータ検証
# --------------------------------------------------------------------------------------


def _clamp(value: Any, low: float, high: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number:  # NaN
        return default
    return max(low, min(high, number))


def parse_run_params(body: dict[str, Any], min_sleep: float) -> dict[str, Any]:
    """ブラウザから来た設定を安全な範囲に丸める。URL 系は受け付けない。"""
    raw_tags = body.get("tags") or []
    if isinstance(raw_tags, str):
        raw_tags = [raw_tags]
    tags: list[str] = []
    seen: set[str] = set()
    for item in raw_tags:
        if not isinstance(item, str):
            continue
        for part in item.replace("　", " ").replace(",", "\n").replace("、", "\n").split("\n"):
            tag = part.strip()
            if tag and tag not in seen:
                seen.add(tag)
                tags.append(tag)

    return {
        "limit": int(_clamp(body.get("limit", 20), 1, 200, 20)),
        "sleep": _clamp(body.get("sleep", min_sleep), min_sleep, 60.0, min_sleep),
        "timeout": _clamp(body.get("timeout", 20.0), 3.0, 120.0, 20.0),
        "max_retries": int(_clamp(body.get("max_retries", 3), 1, 5, 3)),
        "use_ranking": bool(body.get("use_ranking", True)),
        "ranking_pages": int(_clamp(body.get("ranking_pages", 1), 1, 10, 1)),
        "tags": tags[:200],
    }


# --------------------------------------------------------------------------------------
# HTTP ハンドラ
# --------------------------------------------------------------------------------------


class AppHandler(BaseHTTPRequestHandler):
    server_version = "PixivTrendsWeb/1.0"
    runner: JobRunner          # ThreadingHTTPServer 側から注入
    min_sleep: float

    # -- 共通 -------------------------------------------------------------------------

    def _send(self, status: int, content_type: str, body: bytes,
              extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, "application/json; charset=utf-8", body)

    def _send_error_json(self, status: int, message: str) -> None:
        self._send_json({"error": message}, status=status)

    def _read_json_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if length <= 0:
            return {}
        if length > MAX_BODY_BYTES:
            raise ValueError("リクエストが大きすぎます")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise ValueError(f"JSON として読めません: {exc}") from exc
        return payload if isinstance(payload, dict) else {}

    def log_message(self, fmt: str, *args) -> None:
        LOG.debug("%s - %s", self.address_string(), fmt % args)

    # -- ルーティング -----------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        query = dict(pair.split("=", 1) for pair in urlparse(self.path).query.split("&")
                     if "=" in pair)

        if path in ("/", "/index.html"):
            self._serve_ui()
        elif path == "/api/status":
            self._api_status(query)
        elif path == "/api/result":
            self._api_result()
        elif path == "/api/csv":
            self._api_csv()
        else:
            self._send_error_json(404, "見つかりません")

    do_HEAD = do_GET

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            body = self._read_json_body()
        except ValueError as exc:
            self._send_error_json(400, str(exc))
            return

        if path == "/api/run":
            self._api_run(body)
        elif path == "/api/cancel":
            self._send_json({"cancelled": self.runner.cancel()})
        else:
            self._send_error_json(404, "見つかりません")

    # -- 各エンドポイント -------------------------------------------------------------

    def _serve_ui(self) -> None:
        ui_file = UI_DIR / "index.html"
        try:
            body = ui_file.read_bytes()
        except OSError:
            self._send(500, "text/plain; charset=utf-8",
                       f"UI ファイルが見つかりません: {ui_file}".encode("utf-8"))
            return
        self._send(200, "text/html; charset=utf-8", body)

    def _api_run(self, body: dict[str, Any]) -> None:
        params = parse_run_params(body, self.min_sleep)
        try:
            self.runner.start(params)
        except RuntimeError as exc:
            self._send_error_json(409, str(exc))
            return
        self._send_json({"started": True, "params": params})

    def _api_status(self, query: dict[str, str]) -> None:
        job = self.runner.job
        if job is None:
            self._send_json({"state": "idle", "logs": [], "log_seq": 0})
            return
        try:
            since = int(query.get("since", "0"))
        except ValueError:
            since = 0
        self._send_json(job.snapshot(since=since))

    def _api_result(self) -> None:
        job = self.runner.job
        if job is None:
            self._send_json({"series": [], "row_count": 0})
            return
        self._send_json(job.result_payload())

    def _api_csv(self) -> None:
        job = self.runner.job
        if job is None or job.frame.empty:
            self._send_error_json(404, "ダウンロードできるデータがありません")
            return
        self._send(
            200,
            "text/csv; charset=utf-8",
            job.csv_bytes(),
            {"Content-Disposition": 'attachment; filename="pixiv_trend_views.csv"'},
        )


# --------------------------------------------------------------------------------------
# 起動
# --------------------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ピクシブ百科事典トレンド収集ツールのブラウザ UI を起動します。",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--host", default="127.0.0.1",
                        help="待ち受けアドレス(既定は自分の PC からのみ)")
    parser.add_argument("--port", type=int, default=8765, help="待ち受けポート")
    parser.add_argument("--no-browser", action="store_true", help="ブラウザを自動で開かない")
    parser.add_argument("--dic-base", default=ft.DEFAULT_DIC_BASE,
                        help="ピクシブ百科事典のベース URL")
    parser.add_argument("--ranking-url", default=ft.DEFAULT_RANKING_URL,
                        help="pixiv ランキング JSON の URL")
    parser.add_argument("--min-sleep", type=float, default=ft.MIN_REQUEST_INTERVAL,
                        help="UI から指定できる最小リクエスト間隔(秒)")
    parser.add_argument("-v", "--verbose", action="store_true", help="デバッグログを出力する")
    return parser


def create_server(args: argparse.Namespace) -> ThreadingHTTPServer:
    handler = type("BoundAppHandler", (AppHandler,), {
        "runner": JobRunner(args.dic_base.rstrip("/"), args.ranking_url),
        "min_sleep": float(args.min_sleep),
    })
    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.daemon_threads = True
    return server


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    server = create_server(args)
    host, port = server.server_address[:2]
    display_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    url = f"http://{display_host}:{port}/"

    print(f"\n  ピクシブ百科事典 トレンド収集ツール\n  → {url}\n  (終了するには Ctrl+C)\n")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n終了します")
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
