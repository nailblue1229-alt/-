"""링크 추출 / 페이지 파싱 / 파일명 정리 단위 테스트."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from xhs_dl import core, extract  # noqa: E402
from xhs_dl.core import media_extension, safe_filename  # noqa: E402
from xhs_dl.extract import ExtractError, parse_note  # noqa: E402
from xhs_dl import links  # noqa: E402
from xhs_dl.links import extract_links  # noqa: E402

SHARE_TEXT = """87 [饭盒优等生，分格设计自带刀叉 - 一碗小面面| rednote - 나만의 라이프스타일] jfHaah6nCCkXNqn https://www.xiaohongshu.com/discovery/item/69c27850000000001a02d12f?source=webshare&xhsshare=pc_web&xsec_token=AByJqmwMy_9mmoSa=&xsec_source=pc_share
88 [두 번째 영상] https://www.xiaohongshu.com/explore/1234567890abcdef12345678?xsec_token=ABC
89 [단축 링크] http://xhslink.com/a/AbCdEf1
87 [중복] https://www.xiaohongshu.com/discovery/item/69c27850000000001a02d12f?other=1
그냥 잡담 한 줄, 링크 없음
"""


def build_page(note_id: str, video: bool = True) -> str:
    note = {
        "title": "饭盒优等生",
        "desc": "본문 설명",
        "user": {"nickname": "一碗小面面"},
        "imageList": [
            {
                "urlDefault": "https://sns-webpic.xhscdn.com/a.jpg?imageView2/2/w/1080",
                "infoList": [
                    {"imageScene": "WB_DFT", "url": "https://sns-img.xhscdn.com/orig.jpg"}
                ],
            }
        ],
    }
    if video:
        note["video"] = {
            "media": {
                "stream": {
                    "h264": [
                        {
                            "masterUrl": "https://sns-video-bd.xhscdn.com/v.mp4",
                            "backupUrls": ["https://backup.xhscdn.com/v.mp4"],
                        }
                    ]
                }
            }
        }
    state = {"note": {"noteDetailMap": {note_id: {"note": note}}}, "user": None}
    blob = json.dumps(state, ensure_ascii=False).replace('"user": null', '"user": undefined')
    return f"<html><body><script>window.__INITIAL_STATE__={blob}</script></body></html>"


class LinkTests(unittest.TestCase):
    def test_extracts_and_dedupes(self) -> None:
        links = extract_links(SHARE_TEXT)
        self.assertEqual(len(links), 3)
        self.assertEqual(links[0].note_id, "69c27850000000001a02d12f")
        self.assertTrue(links[2].is_short_link)

    def test_keeps_xsec_token(self) -> None:
        url = extract_links(SHARE_TEXT)[0].url
        self.assertIn("xsec_token=AByJqmwMy_9mmoSa=", url)

    def test_fallback_title_strips_suffix(self) -> None:
        self.assertEqual(extract_links(SHARE_TEXT)[0].fallback_title, "饭盒优等生，分格设计自带刀叉")

    def test_bare_note_id(self) -> None:
        links = extract_links("69c27850000000001a02d12f")
        self.assertEqual(len(links), 1)
        self.assertTrue(links[0].url.endswith("69c27850000000001a02d12f"))

    def test_ignores_non_xhs_urls(self) -> None:
        self.assertEqual(extract_links("https://youtube.com/watch?v=abc"), [])


class ParseTests(unittest.TestCase):
    note_id = "69c27850000000001a02d12f"

    def test_video_note(self) -> None:
        note = parse_note(build_page(self.note_id), "https://x/", self.note_id)
        self.assertEqual(note.kind, "video")
        self.assertEqual(note.video_url, "https://sns-video-bd.xhscdn.com/v.mp4")
        self.assertEqual(note.author, "一碗小面面")
        self.assertEqual(note.title, "饭盒优等生")

    def test_image_note_prefers_original(self) -> None:
        note = parse_note(build_page(self.note_id, video=False), "https://x/", self.note_id)
        self.assertEqual(note.kind, "image")
        self.assertEqual(note.image_urls, ["https://sns-img.xhscdn.com/orig.jpg"])

    def test_regex_fallback_without_state(self) -> None:
        page = '<meta property="og:video" content="https://sns-video-bd.xhscdn.com/f.mp4">'
        note = parse_note(page, "https://x/", self.note_id)
        self.assertEqual(note.video_url, "https://sns-video-bd.xhscdn.com/f.mp4")

    def test_login_wall_message(self) -> None:
        with self.assertRaises(ExtractError) as ctx:
            parse_note("<html>请先登录</html>", "https://x/", self.note_id)
        self.assertIn("쿠키", str(ctx.exception))


class NamingTests(unittest.TestCase):
    def test_illegal_chars_removed(self) -> None:
        self.assertEqual(safe_filename('a/b:c*d?"'), "a b c d")

    def test_empty_falls_back(self) -> None:
        self.assertEqual(safe_filename("   ", fallback="note1"), "note1")

    def test_length_capped(self) -> None:
        self.assertLessEqual(len(safe_filename("가" * 200)), 80)

    def test_extension_from_url(self) -> None:
        self.assertEqual(media_extension("https://a/b/c.mp4?x=1", ".bin"), ".mp4")
        self.assertEqual(media_extension("https://a/b/stream", ".mp4"), ".mp4")


if __name__ == "__main__":
    unittest.main(verbosity=2)


class DiagnoseFailureTests(unittest.TestCase):
    """미디어를 못 찾았을 때 원인을 구분하는지 확인합니다."""

    def _error(self, page: str, url: str = "https://www.xiaohongshu.com/discovery/item/abc"):
        with self.assertRaises(extract.ExtractError) as ctx:
            extract.parse_note(page, url, "abc")
        return ctx.exception

    def test_login_wall_is_reported_as_login(self):
        error = self._error("<html><body>扫码登录后查看更多</body></html>")
        self.assertEqual(error.reason, "login")
        self.assertIn("쿠키", str(error))

    def test_redirect_to_login_page_is_reported_as_login(self):
        error = self._error("<html></html>", url="https://www.xiaohongshu.com/login")
        self.assertEqual(error.reason, "login")

    def test_page_without_state_is_not_blamed_on_expiry(self):
        """차단 페이지를 '링크 만료'로 잘못 안내하던 버그."""
        error = self._error("<html><body><div id=app></div></body></html>")
        self.assertEqual(error.reason, "login")
        self.assertNotIn("만료가", str(error).replace("만료가 아니라", ""))

    def test_empty_note_map_is_reported_as_expired(self):
        page = 'window.__INITIAL_STATE__ = {"note":{"noteDetailMap":{}}}'
        error = self._error(page)
        self.assertEqual(error.reason, "empty")
        self.assertIn("만료", str(error))


class FailureAdviceTests(unittest.TestCase):
    def _failed(self, reason: str) -> core.Result:
        return core.Result(index=1, url="u", status="failed", reason=reason)

    def test_all_login_failures_without_cookie_suggest_cookie(self):
        advice = core.failure_advice([self._failed("login")] * 3, cookie="")
        self.assertIn("쿠키", advice)
        self.assertIn("만료가 아니라", advice)

    def test_all_login_failures_with_cookie_suggest_refresh(self):
        advice = core.failure_advice([self._failed("login")], cookie="a=b")
        self.assertIn("새로 복사", advice)

    def test_all_empty_failures_suggest_reshare(self):
        advice = core.failure_advice([self._failed("empty")], cookie="")
        self.assertIn("다시 공유", advice)

    def test_success_only_has_no_advice(self):
        self.assertEqual(core.failure_advice([core.Result(index=1, url="u", status="ok")]), "")


class ExploreUrlTests(unittest.TestCase):
    def test_discovery_path_becomes_explore_keeping_query(self):
        url = (
            "https://www.xiaohongshu.com/discovery/item/6a03cd76000000003501fda7"
            "?source=webshare&xsec_token=ABvAyu=&xsec_source=pc_share"
        )
        self.assertEqual(
            links.explore_url(url),
            "https://www.xiaohongshu.com/explore/6a03cd76000000003501fda7"
            "?source=webshare&xsec_token=ABvAyu=&xsec_source=pc_share",
        )

    def test_non_xiaohongshu_host_is_left_alone(self):
        url = "http://127.0.0.1:8000/note"
        self.assertEqual(links.explore_url(url, "6a03cd76000000003501fda7"), url)

    def test_url_without_note_id_is_left_alone(self):
        url = "https://www.xiaohongshu.com/explore"
        self.assertEqual(links.explore_url(url), url)
