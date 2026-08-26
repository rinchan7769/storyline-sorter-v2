#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_fetch_pixiv_trends.py — fetch_pixiv_trends.py の動作確認テスト

pixiv 本体には接続せず、ローカルに立てたモック HTTP サーバを相手に
「トップページからのタグ抽出 → 各記事ページの閲覧グラフ抽出 → CSV 出力」
という一連の流れを検証する。

実行:
    python test_fetch_pixiv_trends.py          # または python -m unittest -v test_fetch_pixiv_trends
"""

from __future__ import annotations

import csv
import json
import tempfile
import threading
import unittest
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import fetch_pixiv_trends as ft

# --------------------------------------------------------------------------------------
# モックのページ群
# --------------------------------------------------------------------------------------

TOP_PAGE = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>ピクシブ百科事典</title></head>
<body>
  <nav>
    <a href="/">ピクシブ百科事典</a>
    <a href="/a/%E3%83%98%E3%83%AB%E3%83%97">ヘルプ</a>
    <a href="/a/%E8%A8%98%E4%BA%8B%E3%81%AE%E6%9B%B8%E3%81%8D%E6%96%B9">記事の書き方</a>
    <a href="/a/%E3%82%A2%E3%83%8B%E3%83%A1">アニメ</a>
    <a href="/c/anime">アニメカテゴリ</a>
    <a href="https://www.google.com/a/%E5%A4%96%E9%83%A8">外部リンク</a>
  </nav>
  <section class="ranking">
    <h2>注目の記事</h2>
    <ul>
      <li><a href="/a/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF">初音ミク</a></li>
      <li><a href="/a/%E3%81%9A%E3%82%93%E3%81%A0%E3%82%82%E3%82%93">ずんだもん</a></li>
      <li><a href="/a/%E7%AB%88%E9%96%80%E7%82%AD%E6%B2%BB%E9%83%8E">竈門炭治郎</a></li>
      <li><a href="/a/%E5%AD%98%E5%9C%A8%E3%81%97%E3%81%AA%E3%81%84%E3%82%BF%E3%82%B0">存在しないタグ</a></li>
      <li><a href="/a/%E3%82%B0%E3%83%A9%E3%83%95%E7%84%A1%E3%81%97">グラフ無し</a></li>
      <li><a href="/a/%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC%E4%B8%80%E8%A6%A7">キャラクター一覧</a></li>
      <li><a href="/a/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF">初音ミク(重複)</a></li>
    </ul>
  </section>
</body></html>
"""

# パターン1: data-views 属性に JSON (list of dict) が入っている
ARTICLE_DATA_VIEWS = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>初音ミク</title></head>
<body>
  <h1>初音ミク</h1>
  <section class="view-graph">
    <h2>このタグがついたpixivの作品閲覧データ</h2>
    <div id="js-view-chart"
         data-views='[{"date":"2026-08-20","views":12000},{"date":"2026-08-21","views":13500},
                      {"date":"2026-08-22","views":11800},{"date":"2026-08-23","views":15020}]'></div>
  </section>
</body></html>
"""

# パターン2: script 内の chart.js 形式 (labels / datasets)
ARTICLE_SCRIPT_CHART = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>ずんだもん</title></head>
<body>
  <h1>ずんだもん</h1>
  <section>
    <h2>このタグがついたpixivの作品閲覧データ</h2>
    <canvas id="view-chart"></canvas>
  </section>
  <script>
    var chartData = {
      "labels": ["2026-08-20", "2026-08-21", "2026-08-22"],
      "datasets": [{"label": "閲覧数", "data": [880, 1240, 1610]}]
    };
    new Chart(document.getElementById('view-chart'), {type: 'line', data: chartData});
  </script>
</body></html>
"""

# パターン3: 数値配列 + 別属性のラベル、かつ日付が "M/D" 形式
ARTICLE_ATTR_PAIR = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>竈門炭治郎</title></head>
<body>
  <h1>竈門炭治郎</h1>
  <div class="graph" data-labels="8/20,8/21,8/22" data-views="4500,4700,5100"></div>
</body></html>
"""

# パターン4: グラフが存在しない記事
ARTICLE_NO_GRAPH = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>グラフ無し</title></head>
<body><h1>グラフ無し</h1><p>この記事にはまだ閲覧データがありません。</p></body></html>
"""

RANKING_JSON = {
    "contents": [
        {"title": "作品A", "tags": ["初音ミク", "オリジナル", "女の子"]},
        {"title": "作品B", "tags": ["ずんだもん", "R-18", "初音ミク"]},
        {"title": "作品C", "tags": ["ランキング限定タグ", "落書き"]},
    ]
}

PAGES: dict[str, str] = {
    "/": TOP_PAGE,
    "/a/初音ミク": ARTICLE_DATA_VIEWS,
    "/a/ずんだもん": ARTICLE_SCRIPT_CHART,
    "/a/竈門炭治郎": ARTICLE_ATTR_PAIR,
    "/a/グラフ無し": ARTICLE_NO_GRAPH,
    "/a/ランキング限定タグ": ARTICLE_DATA_VIEWS,
}


class _MockHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler の API)
        path = unquote(urlparse(self.path).path)
        self.server.request_paths.append(path)  # type: ignore[attr-defined]

        if path == "/ranking.php":
            body = json.dumps(RANKING_JSON, ensure_ascii=False).encode("utf-8")
            self._respond(200, "application/json; charset=utf-8", body)
            return

        page = PAGES.get(path)
        if page is None:
            self._respond(404, "text/html; charset=utf-8",
                          "<html><body>404 Not Found</body></html>".encode("utf-8"))
            return
        self._respond(200, "text/html; charset=utf-8", page.encode("utf-8"))

    def _respond(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # テスト出力を汚さない
        pass


class MockServerTestCase(unittest.TestCase):
    """モックサーバを立ててスクレイパ全体を動かすテスト。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _MockHandler)
        cls.server.request_paths = []  # type: ignore[attr-defined]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        host, port = cls.server.server_address[:2]
        cls.base = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self) -> None:
        self.server.request_paths.clear()  # type: ignore[attr-defined]
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.output = str(Path(self.tmpdir.name) / "pixiv_trend_views.csv")

    def run_tool(self, *extra: str) -> int:
        return ft.main([
            "--dic-base", self.base,
            "--ranking-url", f"{self.base}/ranking.php?mode=daily&format=json",
            "--sleep", "0",           # ローカルのモック相手なので待機不要(pixiv では 2 秒が強制される)
            "--output", self.output,
            *extra,
        ])

    # -- エンドツーエンド ------------------------------------------------------------

    def test_creates_csv_with_expected_rows(self) -> None:
        exit_code = self.run_tool("--limit", "10")
        self.assertEqual(exit_code, 0)

        path = Path(self.output)
        self.assertTrue(path.exists(), "CSV が生成されていない")

        # BOM 付き UTF-8 で保存されていること
        self.assertTrue(path.read_bytes().startswith(b"\xef\xbb\xbf"), "BOM が付いていない")

        with path.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))

        self.assertEqual(list(rows[0].keys()), ["tag_name", "date", "views", "article_url"])

        tags = {row["tag_name"] for row in rows}
        # 3 パターンすべてのグラフ形式から取得できていること
        self.assertIn("初音ミク", tags)
        self.assertIn("ずんだもん", tags)
        self.assertIn("竈門炭治郎", tags)
        # 404 / グラフ無しはスキップされること
        self.assertNotIn("存在しないタグ", tags)
        self.assertNotIn("グラフ無し", tags)
        # カテゴリ/システムタグは収集対象外
        self.assertNotIn("アニメ", tags)
        self.assertNotIn("ヘルプ", tags)
        self.assertNotIn("記事の書き方", tags)
        self.assertNotIn("キャラクター一覧", tags)

        miku = [row for row in rows if row["tag_name"] == "初音ミク"]
        self.assertEqual(len(miku), 4)
        self.assertEqual(miku[0]["date"], "2026-08-20")
        self.assertEqual(miku[0]["views"], "12000")
        self.assertEqual(miku[-1]["views"], "15020")
        self.assertTrue(miku[0]["article_url"].endswith("/a/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF"))

        # 日付昇順に並んでいること
        dates = [row["date"] for row in miku]
        self.assertEqual(dates, sorted(dates))

        zunda = [row for row in rows if row["tag_name"] == "ずんだもん"]
        self.assertEqual([row["views"] for row in zunda], ["880", "1240", "1610"])

    def test_ranking_is_used_as_additional_source(self) -> None:
        exit_code = self.run_tool("--limit", "20")
        self.assertEqual(exit_code, 0)
        paths = self.server.request_paths  # type: ignore[attr-defined]
        self.assertIn("/ranking.php", paths)
        # ランキングにしか現れないタグも収集される
        self.assertIn("/a/ランキング限定タグ", paths)
        # ランキング由来の汎用タグは除外される
        self.assertNotIn("/a/オリジナル", paths)
        self.assertNotIn("/a/女の子", paths)

    def test_no_ranking_option(self) -> None:
        exit_code = self.run_tool("--limit", "20", "--no-ranking")
        self.assertEqual(exit_code, 0)
        paths = self.server.request_paths  # type: ignore[attr-defined]
        self.assertNotIn("/ranking.php", paths)

    def test_explicit_tags_skip_trend_collection(self) -> None:
        exit_code = self.run_tool("--tags", "ずんだもん")
        self.assertEqual(exit_code, 0)
        paths = self.server.request_paths  # type: ignore[attr-defined]
        self.assertEqual(paths, ["/a/ずんだもん"])

        with open(self.output, encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual({row["tag_name"] for row in rows}, {"ずんだもん"})

    def test_limit_is_respected(self) -> None:
        exit_code = self.run_tool("--limit", "1")
        self.assertEqual(exit_code, 0)
        article_paths = [p for p in self.server.request_paths  # type: ignore[attr-defined]
                         if p.startswith("/a/")]
        self.assertEqual(len(article_paths), 1)

    def test_all_tags_failing_returns_error_but_writes_header(self) -> None:
        exit_code = self.run_tool("--tags", "グラフ無し", "存在しないタグ")
        self.assertEqual(exit_code, 1)
        with open(self.output, encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            header = next(reader)
            self.assertEqual(header, ["tag_name", "date", "views", "article_url"])
            self.assertEqual(list(reader), [])


class ThrottleTestCase(unittest.TestCase):
    """pixiv 本番ホストには 2 秒以上の間隔が強制されることの確認。"""

    def test_pixiv_hosts_are_throttled_to_at_least_two_seconds(self) -> None:
        session = ft.PoliteSession(interval=0.0)
        for url in ("https://dic.pixiv.net/a/x", "https://www.pixiv.net/ranking.php",
                    "https://pixiv.net/"):
            self.assertGreaterEqual(session._interval_for(url), ft.MIN_REQUEST_INTERVAL, url)

    def test_local_hosts_use_requested_interval(self) -> None:
        session = ft.PoliteSession(interval=0.0)
        self.assertEqual(session._interval_for("http://127.0.0.1:8000/"), 0.0)

    def test_requested_interval_can_only_increase(self) -> None:
        session = ft.PoliteSession(interval=5.0)
        self.assertEqual(session._interval_for("https://dic.pixiv.net/"), 5.0)

    def test_user_agent_header_is_set(self) -> None:
        session = ft.PoliteSession()
        self.assertIn("Mozilla/5.0", session.session.headers["User-Agent"])
        self.assertIn("ja", session.session.headers["Accept-Language"])


class NormalizeTestCase(unittest.TestCase):
    def test_date_formats(self) -> None:
        today = date(2026, 8, 26)
        cases = {
            "2026-08-01": "2026-08-01",
            "2026/08/01": "2026-08-01",
            "2026年8月1日": "2026-08-01",
            "20260801": "2026-08-01",
            "2026-08-01T12:34:56Z": "2026-08-01",
            "8/1": "2026-08-01",
            "8月1日": "2026-08-01",
            20260801: "2026-08-01",
            1785542400: "2026-08-01",       # epoch 秒
            1785542400000: "2026-08-01",    # epoch ミリ秒
            date(2026, 8, 1): "2026-08-01",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(ft.normalize_date(raw, today=today), expected)

    def test_future_month_day_rolls_back_a_year(self) -> None:
        # 実行日より先の "12/31" は前年とみなす
        self.assertEqual(ft.normalize_date("12/31", today=date(2026, 8, 26)), "2025-12-31")

    def test_invalid_dates(self) -> None:
        for raw in ("", "  ", "閲覧数", "2026-13-45", None, True, 42):
            with self.subTest(raw=raw):
                self.assertIsNone(ft.normalize_date(raw, today=date(2026, 8, 26)))

    def test_views_values(self) -> None:
        self.assertEqual(ft.normalize_views(1234), 1234)
        self.assertEqual(ft.normalize_views("1,234"), 1234)
        self.assertEqual(ft.normalize_views("1234 views"), 1234)
        self.assertEqual(ft.normalize_views("12,345回"), 12345)
        self.assertEqual(ft.normalize_views(1234.6), 1235)
        self.assertEqual(ft.normalize_views(0), 0)
        for raw in (None, True, -5, "", "abc"):
            with self.subTest(raw=raw):
                self.assertIsNone(ft.normalize_views(raw))


class ExtractionTestCase(unittest.TestCase):
    def test_data_views_attribute(self) -> None:
        series = ft.extract_view_series(ARTICLE_DATA_VIEWS)
        self.assertEqual(series[0], ("2026-08-20", 12000))
        self.assertEqual(len(series), 4)

    def test_script_chart_json(self) -> None:
        series = ft.extract_view_series(ARTICLE_SCRIPT_CHART)
        self.assertEqual(series, [("2026-08-20", 880), ("2026-08-21", 1240), ("2026-08-22", 1610)])

    def test_labels_plus_values_attributes(self) -> None:
        series = ft.extract_view_series(ARTICLE_ATTR_PAIR, today=date(2026, 8, 26))
        self.assertEqual(series, [("2026-08-20", 4500), ("2026-08-21", 4700), ("2026-08-22", 5100)])

    def test_date_to_views_mapping_in_script(self) -> None:
        html = """<html><body><script type="application/json">
        {"viewsData": {"2026-08-01": 10, "2026-08-02": 20}}
        </script></body></html>"""
        self.assertEqual(ft.extract_view_series(html),
                         [("2026-08-01", 10), ("2026-08-02", 20)])

    def test_pairs_nested_in_next_data(self) -> None:
        html = """<html><body><script id="__NEXT_DATA__">
        window.__NEXT_DATA__ = {"props":{"pageProps":{"article":{"viewHistory":
        [["2026-08-01", 5], ["2026-08-02", 7], ["2026-08-03", 9]]}}}};
        </script></body></html>"""
        self.assertEqual(ft.extract_view_series(html),
                         [("2026-08-01", 5), ("2026-08-02", 7), ("2026-08-03", 9)])

    def test_duplicate_dates_are_merged(self) -> None:
        html = """<html><body><div data-views='[{"date":"2026-08-01","views":1},
        {"date":"2026-08-01","views":3}]'></div></body></html>"""
        self.assertEqual(ft.extract_view_series(html), [("2026-08-01", 3)])

    def test_missing_graph_raises(self) -> None:
        with self.assertRaises(ft.GraphNotFoundError):
            ft.extract_view_series(ARTICLE_NO_GRAPH)


class TagFilterTestCase(unittest.TestCase):
    def test_extract_tags_from_top_page(self) -> None:
        tags = ft.extract_tags_from_html(TOP_PAGE, "https://dic.pixiv.net/")
        self.assertEqual(tags[:3], ["初音ミク", "ずんだもん", "竈門炭治郎"])
        for excluded in ("ヘルプ", "記事の書き方", "アニメ", "キャラクター一覧", "外部"):
            self.assertNotIn(excluded, tags)
        self.assertEqual(len(tags), len(set(tags)), "重複が除去されていない")

    def test_is_valid_tag(self) -> None:
        for tag in ("初音ミク", "ずんだもん", "鬼滅の刃"):
            self.assertTrue(ft.is_valid_tag(tag), tag)
        for tag in ("", "   ", "ピクシブ百科事典", "R-18", "アニメ", "作品一覧",
                    "曖昧さ回避", "123", "----", "あ" * 61):
            self.assertFalse(ft.is_valid_tag(tag), tag)


if __name__ == "__main__":
    unittest.main(verbosity=2)
