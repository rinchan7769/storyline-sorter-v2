#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_pixiv_trends.py — ピクシブ百科事典 / pixiv のトレンドタグと閲覧推移を収集して CSV 出力する

処理の流れ:
    1. ピクシブ百科事典トップ (https://dic.pixiv.net/) と
       pixiv デイリーランキング (https://www.pixiv.net/ranking.php?...&format=json) から、
       いま話題になっている作品・キャラクターのタグ一覧を集める。
       ナビゲーション/カテゴリ/システムタグは除外する。
    2. 各タグの記事ページ https://dic.pixiv.net/a/<タグ名> を開き、
       「このタグがついたpixivの作品閲覧データ」のグラフデータを抽出する。
       - HTML 属性 `data-views`(および data-labels 等の兄弟属性)
       - <script> タグ内に埋め込まれた JSON (chart.js 形式 / 日付→閲覧数 の連想配列など)
    3. tag_name カラムを付けて日別閲覧数の縦持ちテーブルに結合し、
       pixiv_trend_views.csv (UTF-8 BOM付き) として保存する。

マナー:
    * pixiv 系ホストへのリクエストは必ず 2 秒以上の間隔を空ける(--sleep で延長のみ可)。
    * ブラウザ相当の User-Agent と Accept-Language を送る。
    * 404 / グラフ無し / パース失敗のページはログを出してスキップし、処理は続行する。
    * 取得したデータの利用は pixiv の利用規約の範囲内で行うこと。

使い方:
    pip install -r requirements.txt
    python fetch_pixiv_trends.py                       # トレンド上位20タグを取得
    python fetch_pixiv_trends.py --limit 50            # 取得タグ数を変更
    python fetch_pixiv_trends.py --tags 初音ミク ずんだもん  # タグを直接指定
    python fetch_pixiv_trends.py --list-tags-only      # タグ抽出だけ試す(記事は開かない)
    python fetch_pixiv_trends.py -o out.csv -v         # 出力先変更 + 詳細ログ
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Sequence
from urllib.parse import quote, unquote, urljoin, urlparse

import pandas as pd
import requests
from bs4 import BeautifulSoup

# --------------------------------------------------------------------------------------
# 設定
# --------------------------------------------------------------------------------------

DEFAULT_DIC_BASE = "https://dic.pixiv.net"
DEFAULT_RANKING_URL = "https://www.pixiv.net/ranking.php?mode=daily&content=illust&format=json"
DEFAULT_OUTPUT = "pixiv_trend_views.csv"

#: pixiv 系ホストに対して強制する最小リクエスト間隔(秒)。要件により 2 秒未満にはできない。
MIN_REQUEST_INTERVAL = 2.0

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
}

#: 百科事典トップ以外に、トレンド候補を探しに行く一覧ページのパス。
#: 存在しない場合は 404 としてスキップされるだけなので、増やしても安全。
DEFAULT_DIC_PATHS: tuple[str, ...] = ("/",)

LOG = logging.getLogger("pixiv_trends")

# --------------------------------------------------------------------------------------
# タグ抽出まわりのフィルタ
# --------------------------------------------------------------------------------------

#: 記事ページの URL パターン (/a/<タグ名>)
ARTICLE_PATH_RE = re.compile(r"^/a/(?P<tag>[^/?#]+)/?$")

#: ナビゲーション/システム記事として除外する完全一致のタグ名
EXCLUDED_TAGS_EXACT: frozenset[str] = frozenset(
    {
        "ピクシブ百科事典",
        "pixiv",
        "pixiv百科事典",
        "百科事典",
        "ヘルプ",
        "ガイドライン",
        "利用規約",
        "プライバシーポリシー",
        "お問い合わせ",
        "記事の書き方",
        "編集履歴",
        "新規記事",
        "ログイン",
        "会員登録",
        "運営",
        "運営からのお知らせ",
        "お知らせ",
        "ニュース",
        "メインページ",
        "曖昧さ回避",
        "サンプル",
        "テンプレート",
        "カテゴリ",
        "アニメ",
        "漫画",
        "マンガ",
        "ゲーム",
        "小説",
        "音楽",
        "人物",
        "一般",
        "その他",
        "イラスト",
        "キャラクター",
        "作品",
        "R-18",
        "R-18G",
    }
)

#: 部分一致で除外する語(カテゴリ/一覧/システムページ)
EXCLUDED_TAG_PATTERN = re.compile(
    r"(?:一覧$|の一覧|カテゴリ$|曖昧さ回避|大百科|記事の書き方|編集方法|ヘルプ|"
    r"利用規約|お問い合わせ|運営からのお知らせ|テンプレート)"
)

#: デイリーランキングのタグ集計から除外する、作品/キャラクターではない汎用タグ
RANKING_STOP_TAGS: frozenset[str] = frozenset(
    {
        "オリジナル",
        "創作",
        "二次創作",
        "版権",
        "版権絵",
        "落書き",
        "らくがき",
        "イラスト",
        "漫画",
        "マンガ",
        "漫画作品",
        "アニメ",
        "ゲーム",
        "女の子",
        "男の子",
        "女性",
        "男性",
        "少女",
        "少年",
        "美少女",
        "美少年",
        "おっぱい",
        "尻",
        "水着",
        "制服",
        "スク水",
        "私服",
        "笑顔",
        "背景",
        "風景",
        "けものフレンズ0",
        "R-18",
        "R-18G",
        "R18",
        "ロリ",
        "百合",
        "BL",
        "TL",
        "GL",
        "NL",
        "腐向け",
        "pixiv",
        "P站",
        "AI",
        "AIイラスト",
        "AI生成",
        "AIart",
        "NovelAI",
        "StableDiffusion",
    }
)

# --------------------------------------------------------------------------------------
# 例外
# --------------------------------------------------------------------------------------


class FetchError(Exception):
    """ページ取得に失敗した(リトライ後も回復しなかった)。"""


class GraphNotFoundError(Exception):
    """記事ページに閲覧推移グラフのデータが見つからなかった。"""


# --------------------------------------------------------------------------------------
# HTTP クライアント (スロットリング + リトライ)
# --------------------------------------------------------------------------------------


class PoliteSession:
    """pixiv 系ホストへのアクセス間隔を必ず空けてくれる requests.Session のラッパ。"""

    def __init__(self, interval: float = MIN_REQUEST_INTERVAL, timeout: float = 20.0,
                 max_retries: int = 3) -> None:
        self.requested_interval = float(interval)
        self.timeout = float(timeout)
        self.max_retries = max(1, int(max_retries))
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self._last_request_at: float | None = None

    # -- スロットリング ---------------------------------------------------------------

    @staticmethod
    def _is_pixiv_host(url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        return host == "pixiv.net" or host.endswith(".pixiv.net")

    def _interval_for(self, url: str) -> float:
        """pixiv 本番ホストには最低 2 秒を強制する(テスト用のローカルサーバは対象外)。"""
        if self._is_pixiv_host(url):
            return max(MIN_REQUEST_INTERVAL, self.requested_interval)
        return max(0.0, self.requested_interval)

    def _throttle(self, url: str) -> None:
        interval = self._interval_for(url)
        if interval <= 0:
            return
        if self._last_request_at is None:
            return  # 初回は待たない
        wait = interval - (time.monotonic() - self._last_request_at)
        if wait > 0:
            LOG.debug("待機 %.2f 秒", wait)
            time.sleep(wait)

    # -- 取得 -------------------------------------------------------------------------

    def get(self, url: str, *, allow_404: bool = True) -> requests.Response:
        """GET する。404 は例外にせず呼び出し側に返す(allow_404=True の場合)。"""
        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            self._throttle(url)
            try:
                LOG.debug("GET %s (試行 %d/%d)", url, attempt, self.max_retries)
                response = self.session.get(url, timeout=self.timeout)
            except requests.RequestException as exc:
                last_error = exc
                self._last_request_at = time.monotonic()
                LOG.warning("通信エラー: %s (%s)", url, exc)
            else:
                self._last_request_at = time.monotonic()
                if response.status_code == 404 and allow_404:
                    return response
                if response.status_code == 429 or response.status_code >= 500:
                    last_error = FetchError(f"HTTP {response.status_code}")
                    LOG.warning("HTTP %s: %s", response.status_code, url)
                else:
                    return response

            if attempt < self.max_retries:
                backoff = 2.0 ** attempt
                LOG.info("%.0f 秒待って再試行します", backoff)
                time.sleep(backoff)

        raise FetchError(f"{url} の取得に失敗しました: {last_error}")

    def get_text(self, url: str) -> str | None:
        """本文テキストを返す。404 など取得できなかった場合は None。"""
        response = self.get(url)
        if response.status_code == 404:
            LOG.warning("ページが存在しません (404): %s", url)
            return None
        if response.status_code != 200:
            LOG.warning("想定外のステータス %s: %s", response.status_code, url)
            return None
        if not response.encoding or response.encoding.lower() == "iso-8859-1":
            response.encoding = response.apparent_encoding or "utf-8"
        return response.text


# --------------------------------------------------------------------------------------
# 値の正規化
# --------------------------------------------------------------------------------------

_DATE_YMD_RE = re.compile(r"^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$")
_DATE_COMPACT_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})$")
_DATE_MD_RE = re.compile(r"^(\d{1,2})[-/.月](\d{1,2})日?$")


def normalize_date(value: Any, today: date | None = None) -> str | None:
    """日付らしき値を 'YYYY-MM-DD' に正規化する。解釈できなければ None。"""
    if isinstance(value, bool) or value is None:
        return None

    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, (int, float)):
        number = float(value)
        if 1e11 <= number < 1e14:  # epoch ミリ秒
            return datetime.fromtimestamp(number / 1000.0, tz=timezone.utc).date().isoformat()
        if 1e8 <= number < 1e11:  # epoch 秒
            return datetime.fromtimestamp(number, tz=timezone.utc).date().isoformat()
        if 19000101 <= number <= 99991231:  # YYYYMMDD
            return normalize_date(str(int(number)), today=today)
        return None

    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    # ISO 8601 (日時付きを含む)
    if len(text) >= 10 and text[4] in "-/" and text[7] in "-/":
        head = text[:10].replace("/", "-")
        try:
            return date.fromisoformat(head).isoformat()
        except ValueError:
            pass

    match = _DATE_YMD_RE.match(text)
    if match:
        year, month, day = (int(part) for part in match.groups())
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return None

    match = _DATE_COMPACT_RE.match(text)
    if match:
        year, month, day = (int(part) for part in match.groups())
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return None

    # 「8/1」「8月1日」のように年が無い形式は、実行日から年を補完する
    match = _DATE_MD_RE.match(text)
    if match:
        base = today or date.today()
        month, day = int(match.group(1)), int(match.group(2))
        for year in (base.year, base.year - 1):
            try:
                candidate = date(year, month, day)
            except ValueError:
                continue
            if candidate <= base + timedelta(days=1):
                return candidate.isoformat()
        return None

    return None


#: "1,234 views" / "1234回" のような表記から数値部分だけを残す
_NUMBER_CLEAN_RE = re.compile(r"[^\d.\-]")


def normalize_views(value: Any) -> int | None:
    """閲覧数らしき値を非負の int に正規化する。解釈できなければ None。"""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")) or value < 0:
            return None
        return int(round(value))
    if isinstance(value, str):
        text = _NUMBER_CLEAN_RE.sub("", value).strip()
        if not text:
            return None
        try:
            return normalize_views(float(text))
        except ValueError:
            return None
    return None


# --------------------------------------------------------------------------------------
# JSON 構造から時系列を取り出す
# --------------------------------------------------------------------------------------

DATE_KEYS = ("date", "day", "label", "x", "time", "datetime", "timestamp", "ymd")
VIEW_KEYS = ("views", "view", "view_count", "viewcount", "count", "value", "y", "total", "pv")

LABEL_CONTAINER_KEYS = ("labels", "dates", "days", "categories", "x", "index", "axis")
VALUE_CONTAINER_KEYS = ("data", "values", "views", "counts", "series", "y", "datasets")

Series = list[tuple[str, int]]


def _pick(mapping: dict, keys: Sequence[str]) -> Any:
    """辞書から候補キー(大文字小文字・アンダースコア無視)で最初に見つかった値を返す。"""
    lowered = {str(k).lower().replace("_", ""): v for k, v in mapping.items()}
    for key in keys:
        candidate = key.lower().replace("_", "")
        if candidate in lowered:
            return lowered[candidate]
    return None


def _flatten_values(value: Any) -> list[Any] | None:
    """chart.js の datasets 形式などから、数値配列を取り出す。"""
    if isinstance(value, list):
        if value and all(isinstance(item, dict) for item in value):
            inner = _pick(value[0], ("data", "values", "counts", "y"))
            if isinstance(inner, list):
                return inner
            return None
        return value
    if isinstance(value, dict):
        inner = _pick(value, ("data", "values", "counts", "y"))
        if isinstance(inner, list):
            return _flatten_values(inner)
    return None


def series_from_obj(obj: Any, today: date | None = None) -> Series:
    """JSON 相当のオブジェクト 1 個から (日付, 閲覧数) の並びを取り出す。取れなければ空リスト。"""
    series: Series = []

    if isinstance(obj, list):
        for item in obj:
            if isinstance(item, dict):
                day = normalize_date(_pick(item, DATE_KEYS), today=today)
                views = normalize_views(_pick(item, VIEW_KEYS))
            elif isinstance(item, (list, tuple)) and len(item) == 2:
                day = normalize_date(item[0], today=today)
                views = normalize_views(item[1])
            else:
                continue
            if day is not None and views is not None:
                series.append((day, views))
        return series

    if isinstance(obj, dict):
        labels = _pick(obj, LABEL_CONTAINER_KEYS)
        values = _flatten_values(_pick(obj, VALUE_CONTAINER_KEYS))
        if isinstance(labels, list) and isinstance(values, list):
            for raw_day, raw_views in zip(labels, values):
                day = normalize_date(raw_day, today=today)
                views = normalize_views(raw_views)
                if day is not None and views is not None:
                    series.append((day, views))
            if series:
                return series

        # {"2026-08-01": 1234, ...} 形式
        for raw_day, raw_views in obj.items():
            day = normalize_date(raw_day, today=today)
            views = normalize_views(raw_views)
            if day is not None and views is not None:
                series.append((day, views))
        return series

    return []


def find_series(obj: Any, today: date | None = None, _depth: int = 0) -> Series:
    """入れ子の JSON を再帰的に探索し、最も長い時系列を返す。"""
    if _depth > 8:
        return []

    best = series_from_obj(obj, today=today)

    children: Iterable[Any]
    if isinstance(obj, dict):
        children = obj.values()
    elif isinstance(obj, list):
        children = obj
    else:
        return best

    for child in children:
        if not isinstance(child, (dict, list)):
            continue
        candidate = find_series(child, today=today, _depth=_depth + 1)
        if len(candidate) > len(best):
            best = candidate
    return best


# --------------------------------------------------------------------------------------
# HTML から閲覧推移データを抽出する
# --------------------------------------------------------------------------------------

_JSON_KEY_RE = re.compile(
    r"""["']?(?:views?|viewsData|viewCounts?|articleViews|viewHistory|dailyViews|"""
    r"""graphData|chartData|chart|graph|series|dataPoints)["']?\s*[:=]\s*""",
    re.IGNORECASE,
)
_ASSIGNMENT_RE = re.compile(r"=\s*(?=[\[{])")
_MAX_JSON_CANDIDATES = 200


def _scan_balanced(text: str, start: int) -> str | None:
    """text[start] の括弧に対応する閉じ括弧までを、文字列リテラルを考慮して切り出す。"""
    opener = text[start]
    closer = {"{": "}", "[": "]"}.get(opener)
    if closer is None:
        return None

    depth = 0
    in_string = False
    quote_char = ""
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                in_string = False
            continue
        if char in "\"'":
            in_string = True
            quote_char = char
            continue
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def _iter_json_candidates(script_text: str) -> Iterable[Any]:
    """<script> の中身から JSON として解釈できそうな塊を取り出して yield する。"""
    text = script_text.strip()
    if not text:
        return

    # <script type="application/json"> のように、全体が JSON のケース
    if text[0] in "[{":
        try:
            yield json.loads(text)
        except (ValueError, TypeError):
            pass

    seen_offsets: set[int] = set()
    count = 0
    for pattern in (_JSON_KEY_RE, _ASSIGNMENT_RE):
        for match in pattern.finditer(text):
            start = match.end()
            while start < len(text) and text[start] in " \t\r\n":
                start += 1
            if start >= len(text) or text[start] not in "[{" or start in seen_offsets:
                continue
            seen_offsets.add(start)
            blob = _scan_balanced(text, start)
            if not blob:
                continue
            try:
                yield json.loads(blob)
            except (ValueError, TypeError):
                continue
            count += 1
            if count >= _MAX_JSON_CANDIDATES:
                return


def _series_from_data_attributes(soup: BeautifulSoup, today: date | None) -> Series:
    """`data-views` などの HTML 属性からグラフデータを取り出す。"""
    label_attrs = ("data-labels", "data-dates", "data-days", "data-date-labels", "data-x")
    value_attrs = ("data-views", "data-view-counts", "data-counts", "data-values", "data-graph",
                   "data-chart", "data-series")

    best: Series = []
    for attribute in value_attrs:
        for element in soup.select(f"[{attribute}]"):
            raw = element.get(attribute)
            if not raw or not isinstance(raw, str):
                continue

            parsed: Any = None
            stripped = raw.strip()
            if stripped[:1] in "[{":
                try:
                    parsed = json.loads(stripped)
                except (ValueError, TypeError):
                    parsed = None

            if parsed is not None:
                candidate = find_series(parsed, today=today)
                if len(candidate) > len(best):
                    best = candidate
                if candidate:
                    continue
                values = parsed if isinstance(parsed, list) else None
            else:
                # "123,456,789" のような数値の羅列 + 別属性のラベル
                values = [part for part in re.split(r"[,\s]+", stripped) if part]

            if not values:
                continue
            labels = None
            for label_attribute in label_attrs:
                raw_labels = element.get(label_attribute)
                if not raw_labels or not isinstance(raw_labels, str):
                    continue
                raw_labels = raw_labels.strip()
                if raw_labels[:1] == "[":
                    try:
                        labels = json.loads(raw_labels)
                    except (ValueError, TypeError):
                        labels = None
                else:
                    labels = [part for part in re.split(r"[,\s]+", raw_labels) if part]
                if labels:
                    break
            if not labels:
                continue

            candidate = []
            for raw_day, raw_views in zip(labels, values):
                day = normalize_date(raw_day, today=today)
                views = normalize_views(raw_views)
                if day is not None and views is not None:
                    candidate.append((day, views))
            if len(candidate) > len(best):
                best = candidate
    return best


def extract_view_series(html: str, today: date | None = None) -> Series:
    """記事ページの HTML から日別閲覧数の時系列を抽出する。

    優先順位:
        1. data-views 等の HTML 属性
        2. <script> 内に埋め込まれた JSON
    見つからない場合は GraphNotFoundError を投げる。
    """
    soup = BeautifulSoup(html, "html.parser")

    best = _series_from_data_attributes(soup, today)

    if not best:
        for script in soup.find_all("script"):
            script_text = script.string or script.get_text() or ""
            if not script_text.strip():
                continue
            for candidate_obj in _iter_json_candidates(script_text):
                candidate = find_series(candidate_obj, today=today)
                if len(candidate) > len(best):
                    best = candidate

    if not best:
        raise GraphNotFoundError("閲覧推移グラフのデータが見つかりませんでした")

    # 同じ日付が複数回出てきた場合は後勝ちでまとめ、日付順に整える
    merged: dict[str, int] = {}
    for day, views in best:
        merged[day] = views
    return sorted(merged.items())


# --------------------------------------------------------------------------------------
# トレンドタグの収集
# --------------------------------------------------------------------------------------


def is_valid_tag(tag: str) -> bool:
    """作品/キャラクタータグとして採用してよいか判定する。"""
    tag = tag.strip()
    if not tag or len(tag) > 60:
        return False
    if tag in EXCLUDED_TAGS_EXACT:
        return False
    if EXCLUDED_TAG_PATTERN.search(tag):
        return False
    # 記号だけ・数字だけのものは除外
    if re.fullmatch(r"[\W\d_]+", tag, flags=re.UNICODE):
        return False
    return True


def extract_tags_from_html(html: str, base_url: str) -> list[str]:
    """一覧ページの HTML から記事タグ (/a/<タグ名>) を重複なしで抽出する。"""
    soup = BeautifulSoup(html, "html.parser")
    tags: list[str] = []
    seen: set[str] = set()
    base_host = (urlparse(base_url).hostname or "").lower()

    for anchor in soup.find_all("a", href=True):
        href = anchor["href"].strip()
        if not href:
            continue
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        # 外部サイトへのリンクは対象外(同一ホストまたはそのサブドメインのみ見る)
        host = (parsed.hostname or "").lower()
        if host and base_host and host != base_host and not host.endswith("." + base_host):
            continue
        match = ARTICLE_PATH_RE.match(parsed.path)
        if not match:
            continue
        tag = unquote(match.group("tag")).replace("_", " ").strip()
        if not is_valid_tag(tag) or tag in seen:
            continue
        seen.add(tag)
        tags.append(tag)

    return tags


def collect_tags_from_dic(session: PoliteSession, base: str,
                          paths: Sequence[str] = DEFAULT_DIC_PATHS) -> list[str]:
    """ピクシブ百科事典のトップ/一覧ページからトレンドタグを集める。"""
    collected: list[str] = []
    seen: set[str] = set()
    for path in paths:
        url = urljoin(base.rstrip("/") + "/", path.lstrip("/"))
        try:
            html = session.get_text(url)
        except FetchError as exc:
            LOG.warning("百科事典ページの取得に失敗、スキップします: %s", exc)
            continue
        if html is None:
            continue
        tags = extract_tags_from_html(html, url)
        LOG.info("%s から %d 件のタグ候補を取得", url, len(tags))
        for tag in tags:
            if tag not in seen:
                seen.add(tag)
                collected.append(tag)
    return collected


def collect_tags_from_ranking(session: PoliteSession, ranking_url: str,
                              pages: int = 1) -> list[str]:
    """pixiv デイリーランキング JSON から、出現頻度の高いタグを集める。"""
    counter: Counter[str] = Counter()
    for page in range(1, max(1, pages) + 1):
        separator = "&" if "?" in ranking_url else "?"
        url = f"{ranking_url}{separator}p={page}"
        try:
            response = session.get(url)
        except FetchError as exc:
            LOG.warning("ランキングの取得に失敗、スキップします: %s", exc)
            break
        if response.status_code != 200:
            LOG.warning("ランキングが取得できませんでした (HTTP %s)", response.status_code)
            break
        try:
            payload = response.json()
        except ValueError:
            LOG.warning("ランキングのレスポンスが JSON ではありませんでした: %s", url)
            break

        contents = payload.get("contents") if isinstance(payload, dict) else None
        if not contents:
            LOG.warning("ランキングに contents がありません: %s", url)
            break

        for entry in contents:
            if not isinstance(entry, dict):
                continue
            for tag in entry.get("tags") or []:
                if not isinstance(tag, str):
                    continue
                tag = tag.strip()
                if tag in RANKING_STOP_TAGS or not is_valid_tag(tag):
                    continue
                counter[tag] += 1

    ranked = [tag for tag, _count in counter.most_common()]
    LOG.info("デイリーランキングから %d 件のタグ候補を取得", len(ranked))
    return ranked


def collect_trend_tags(session: PoliteSession, *, dic_base: str, ranking_url: str | None,
                       dic_paths: Sequence[str], ranking_pages: int, limit: int) -> list[str]:
    """百科事典とランキングの両方からトレンドタグを集め、重複を除いて limit 件返す。"""
    tags: list[str] = []
    seen: set[str] = set()

    for source in (collect_tags_from_dic(session, dic_base, dic_paths),
                   collect_tags_from_ranking(session, ranking_url, ranking_pages)
                   if ranking_url else []):
        for tag in source:
            if tag not in seen:
                seen.add(tag)
                tags.append(tag)

    if not tags:
        LOG.error("トレンドタグを 1 件も抽出できませんでした")
    return tags[:limit] if limit > 0 else tags


# --------------------------------------------------------------------------------------
# 各タグの閲覧推移を取得
# --------------------------------------------------------------------------------------


def article_url(base: str, tag: str) -> str:
    return f"{base.rstrip('/')}/a/{quote(tag, safe='')}"


def fetch_tag_series(session: PoliteSession, base: str, tag: str,
                     today: date | None = None) -> pd.DataFrame | None:
    """1 タグ分の記事ページを取得し、tag_name 付きの DataFrame を返す。失敗時は None。"""
    url = article_url(base, tag)
    try:
        html = session.get_text(url)
    except FetchError as exc:
        LOG.warning("[%s] 取得失敗のためスキップ: %s", tag, exc)
        return None
    if html is None:
        LOG.warning("[%s] 記事ページが見つからないためスキップ", tag)
        return None

    try:
        series = extract_view_series(html, today=today)
    except GraphNotFoundError as exc:
        LOG.warning("[%s] %s (スキップ)", tag, exc)
        return None
    except Exception as exc:  # 想定外のパース失敗でも全体は止めない
        LOG.warning("[%s] グラフデータの解析に失敗しました: %s (スキップ)", tag, exc)
        return None

    frame = pd.DataFrame(series, columns=["date", "views"])
    frame.insert(0, "tag_name", tag)
    frame["article_url"] = url
    LOG.info("[%s] %d 日分の閲覧データを取得", tag, len(frame))
    return frame


def build_dataframe(frames: Sequence[pd.DataFrame]) -> pd.DataFrame:
    """全タグ分を結合し、重複排除・並び替えを行う。"""
    columns = ["tag_name", "date", "views", "article_url"]
    if not frames:
        return pd.DataFrame(columns=columns)

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates(subset=["tag_name", "date"], keep="last")
    combined = combined.sort_values(["tag_name", "date"], kind="stable").reset_index(drop=True)
    return combined[columns]


def save_csv(frame: pd.DataFrame, output_path: str) -> None:
    """Excel でもそのまま開けるよう UTF-8 (BOM付き) で保存する。"""
    frame.to_csv(output_path, index=False, encoding="utf-8-sig")
    LOG.info("CSV を書き出しました: %s (%d 行)", output_path, len(frame))


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------


def read_tag_file(path: str) -> list[str]:
    tags: list[str] = []
    with open(path, encoding="utf-8-sig") as handle:
        for line in handle:
            tag = line.strip()
            if tag and not tag.startswith("#"):
                tags.append(tag)
    return tags


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ピクシブ百科事典/pixiv のトレンドタグと日別閲覧数を収集して CSV 出力します。",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("-o", "--output", default=DEFAULT_OUTPUT, help="出力する CSV のパス")
    parser.add_argument("-n", "--limit", type=int, default=20,
                        help="取得するタグ数の上限 (0 で無制限)")
    parser.add_argument("--sleep", type=float, default=MIN_REQUEST_INTERVAL,
                        help=f"リクエスト間隔(秒)。pixiv へのアクセスは最低 {MIN_REQUEST_INTERVAL} 秒")
    parser.add_argument("--timeout", type=float, default=20.0, help="1 リクエストのタイムアウト(秒)")
    parser.add_argument("--max-retries", type=int, default=3, help="通信失敗時の再試行回数")
    parser.add_argument("--tags", nargs="+", metavar="TAG",
                        help="トレンド抽出を行わず、指定したタグだけを取得する")
    parser.add_argument("--tag-file", metavar="PATH",
                        help="1 行 1 タグのテキストファイルからタグを読み込む")
    parser.add_argument("--dic-base", default=DEFAULT_DIC_BASE,
                        help="ピクシブ百科事典のベース URL")
    parser.add_argument("--dic-path", action="append", metavar="PATH",
                        help="タグ候補を探す百科事典内のパス(複数指定可)")
    parser.add_argument("--ranking-url", default=DEFAULT_RANKING_URL,
                        help="pixiv ランキング JSON の URL")
    parser.add_argument("--ranking-pages", type=int, default=1,
                        help="ランキングを何ページ分読むか")
    parser.add_argument("--no-ranking", action="store_true",
                        help="pixiv ランキングをタグ収集元に使わない")
    parser.add_argument("--list-tags-only", action="store_true",
                        help="タグ抽出だけ行って一覧を表示し、記事ページは開かない")
    parser.add_argument("-v", "--verbose", action="store_true", help="デバッグログを出力する")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    session = PoliteSession(interval=args.sleep, timeout=args.timeout,
                            max_retries=args.max_retries)

    # 取得対象タグの決定
    tags: list[str] = []
    if args.tags:
        tags.extend(args.tags)
    if args.tag_file:
        tags.extend(read_tag_file(args.tag_file))

    if tags:
        seen: set[str] = set()
        tags = [tag for tag in tags if not (tag in seen or seen.add(tag))]
        LOG.info("指定された %d 件のタグを取得します", len(tags))
    else:
        tags = collect_trend_tags(
            session,
            dic_base=args.dic_base,
            ranking_url=None if args.no_ranking else args.ranking_url,
            dic_paths=tuple(args.dic_path) if args.dic_path else DEFAULT_DIC_PATHS,
            ranking_pages=args.ranking_pages,
            limit=args.limit,
        )

    if not tags:
        LOG.error("対象タグがありません。処理を終了します。")
        save_csv(build_dataframe([]), args.output)
        return 1

    LOG.info("対象タグ (%d 件): %s", len(tags), ", ".join(tags))

    if args.list_tags_only:
        for tag in tags:
            print(tag)
        return 0

    frames: list[pd.DataFrame] = []
    skipped: list[str] = []
    for index, tag in enumerate(tags, start=1):
        LOG.info("(%d/%d) %s の閲覧データを取得中...", index, len(tags), tag)
        frame = fetch_tag_series(session, args.dic_base, tag)
        if frame is None or frame.empty:
            skipped.append(tag)
            continue
        frames.append(frame)

    combined = build_dataframe(frames)
    save_csv(combined, args.output)

    LOG.info("成功 %d タグ / スキップ %d タグ", len(frames), len(skipped))
    if skipped:
        LOG.info("スキップしたタグ: %s", ", ".join(skipped))

    if combined.empty:
        LOG.error("閲覧データを 1 件も取得できませんでした(ヘッダのみの CSV を出力しました)")
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        LOG.warning("中断されました")
        sys.exit(130)
