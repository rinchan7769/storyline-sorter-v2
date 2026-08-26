#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_web_app.py — web_app.py (ブラウザ UI のサーバ側) のテスト

pixiv には接続せず、test_fetch_pixiv_trends.py のモックサーバを相手に
「/api/run → /api/status → /api/result → /api/csv」の流れを検証する。

実行:
    python test_web_app.py
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import test_fetch_pixiv_trends as mock
import web_app


def http_json(url: str, method: str = "GET", payload: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload or {}).encode("utf-8") if method == "POST" else None
    request = Request(url, data=data, method=method,
                      headers={"Content-Type": "application/json"} if data else {})
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8") or "{}")


class WebAppTestCase(unittest.TestCase):
    """モック pixiv + web_app を立ち上げて API を叩く。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.mock_server = ThreadingHTTPServer(("127.0.0.1", 0), mock._MockHandler)
        cls.mock_server.request_paths = []  # type: ignore[attr-defined]
        cls.mock_thread = threading.Thread(target=cls.mock_server.serve_forever, daemon=True)
        cls.mock_thread.start()
        mock_port = cls.mock_server.server_address[1]
        mock_base = f"http://127.0.0.1:{mock_port}"

        args = argparse.Namespace(
            host="127.0.0.1", port=0,
            dic_base=mock_base,
            ranking_url=f"{mock_base}/ranking.php?mode=daily&format=json",
            min_sleep=0.0,
        )
        cls.app_server = web_app.create_server(args)
        cls.app_thread = threading.Thread(target=cls.app_server.serve_forever, daemon=True)
        cls.app_thread.start()
        cls.base = f"http://127.0.0.1:{cls.app_server.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        for server, thread in ((cls.app_server, cls.app_thread),
                               (cls.mock_server, cls.mock_thread)):
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def wait_until_done(self, timeout: float = 30.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            _status, payload = http_json(f"{self.base}/api/status")
            if payload.get("state") not in ("running",):
                return payload
            time.sleep(0.1)
        self.fail("ジョブが時間内に終わりませんでした")

    # -- 通し ---------------------------------------------------------------------

    def test_full_flow(self) -> None:
        status, payload = http_json(f"{self.base}/api/run", "POST",
                                    {"limit": 10, "sleep": 0, "use_ranking": True})
        self.assertEqual(status, 200, payload)
        self.assertTrue(payload["started"])

        final = self.wait_until_done()
        self.assertEqual(final["state"], "done", final)
        self.assertEqual(final["ok_count"], 4)
        self.assertCountEqual(final["skipped"], ["存在しないタグ", "グラフ無し"])
        self.assertEqual(final["row_count"], 14)
        self.assertTrue(any("初音ミク" in entry["message"] for entry in final["logs"] or [])
                        or final["log_seq"] > 0)

        _status, result = http_json(f"{self.base}/api/result")
        self.assertEqual(result["row_count"], 14)
        tags = {item["tag"] for item in result["series"]}
        self.assertIn("初音ミク", tags)
        self.assertNotIn("グラフ無し", tags)
        # 合計閲覧数の多い順に並んでいること
        totals = [sum(point[1] for point in item["points"]) for item in result["series"]]
        self.assertEqual(totals, sorted(totals, reverse=True))
        # 各系列は日付昇順
        for item in result["series"]:
            dates = [point[0] for point in item["points"]]
            self.assertEqual(dates, sorted(dates))

        # CSV は BOM 付きでダウンロードできる
        with urlopen(f"{self.base}/api/csv", timeout=10) as response:
            self.assertEqual(response.headers["Content-Type"], "text/csv; charset=utf-8")
            self.assertIn("pixiv_trend_views.csv", response.headers["Content-Disposition"])
            raw = response.read()
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf"))
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        self.assertEqual(len(rows), 14)
        self.assertEqual(list(rows[0].keys()), ["tag_name", "date", "views", "article_url"])

    def test_explicit_tags(self) -> None:
        status, _ = http_json(f"{self.base}/api/run", "POST",
                              {"tags": ["ずんだもん, 竈門炭治郎"], "sleep": 0})
        self.assertEqual(status, 200)
        final = self.wait_until_done()
        self.assertEqual(final["total"], 2)
        _status, result = http_json(f"{self.base}/api/result")
        self.assertCountEqual([item["tag"] for item in result["series"]],
                              ["ずんだもん", "竈門炭治郎"])

    def test_ui_is_served(self) -> None:
        with urlopen(f"{self.base}/", timeout=10) as response:
            body = response.read().decode("utf-8")
        self.assertIn("<title>pixiv トレンド収集</title>", body)
        self.assertIn("/api/run", body)

    def test_unknown_path_is_404(self) -> None:
        status, payload = http_json(f"{self.base}/api/nope")
        self.assertEqual(status, 404)
        self.assertIn("error", payload)

    def test_rejects_second_concurrent_run(self) -> None:
        # 実行中に再度 run すると 409 になる(1 件だけ確実に走らせて確認する)
        handler_runner = self.app_server.RequestHandlerClass.runner
        blocker = web_app.Job({"limit": 1, "sleep": 0, "timeout": 5, "max_retries": 1,
                               "use_ranking": False, "ranking_pages": 1, "tags": []})
        handler_runner.job = blocker
        try:
            status, payload = http_json(f"{self.base}/api/run", "POST", {"sleep": 0})
            self.assertEqual(status, 409)
            self.assertIn("実行中", payload["error"])
        finally:
            blocker.state = "done"


class ParamsTestCase(unittest.TestCase):
    """ブラウザから渡される値の丸め込み。"""

    def test_sleep_has_a_floor(self) -> None:
        params = web_app.parse_run_params({"sleep": 0.1}, min_sleep=2.0)
        self.assertEqual(params["sleep"], 2.0)
        params = web_app.parse_run_params({"sleep": 5}, min_sleep=2.0)
        self.assertEqual(params["sleep"], 5.0)

    def test_limit_is_clamped(self) -> None:
        self.assertEqual(web_app.parse_run_params({"limit": 9999}, 2.0)["limit"], 200)
        self.assertEqual(web_app.parse_run_params({"limit": 0}, 2.0)["limit"], 1)
        self.assertEqual(web_app.parse_run_params({"limit": "abc"}, 2.0)["limit"], 20)

    def test_tags_are_split_and_deduped(self) -> None:
        params = web_app.parse_run_params(
            {"tags": ["初音ミク\nずんだもん, 竈門炭治郎、初音ミク\n\n  "]}, 2.0)
        self.assertEqual(params["tags"], ["初音ミク", "ずんだもん", "竈門炭治郎"])

    def test_urls_cannot_be_overridden_from_the_browser(self) -> None:
        params = web_app.parse_run_params(
            {"dic_base": "http://evil.example", "ranking_url": "http://evil.example"}, 2.0)
        self.assertNotIn("dic_base", params)
        self.assertNotIn("ranking_url", params)


if __name__ == "__main__":
    unittest.main(verbosity=2)
