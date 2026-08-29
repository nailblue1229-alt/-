"""링크 추출 / 페이지 파싱 / 파일명 정리 단위 테스트."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from xhs_dl.core import media_extension, safe_filename  # noqa: E402
from xhs_dl.extract import ExtractError, parse_note  # noqa: E402
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
