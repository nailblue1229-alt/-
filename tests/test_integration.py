"""로컬 가짜 서버로 fetch → parse → download 전체 흐름을 확인합니다."""

from __future__ import annotations

import http.server
import json
import socketserver
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from xhs_dl.core import Downloader, Options  # noqa: E402
from xhs_dl.links import PastedLink  # noqa: E402

NOTE_ID = "69c27850000000001a02d12f"
VIDEO_BYTES = b"FAKEMP4DATA" * 5000


def make_state(port: int) -> dict:
    return {
        "note": {
            "noteDetailMap": {
                NOTE_ID: {
                    "note": {
                        "title": "饭盒优等生: 分格/设计",
                        "desc": "본문 설명",
                        "user": {"nickname": "一碗小面面"},
                        "video": {
                            "media": {
                                "stream": {
                                    "h264": [
                                        {"masterUrl": f"http://127.0.0.1:{port}/v.mp4"}
                                    ]
                                }
                            }
                        },
                        "imageList": [],
                    }
                }
            }
        }
    }


class FakeXhsServer:
    """노트 페이지와 영상 파일을 흉내 내는 임시 서버."""

    def __init__(self) -> None:
        state_holder: dict = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:  # 테스트 출력 조용히
                pass

            def _send(self, body: bytes, content_type: str) -> None:
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                if self.path.startswith("/note"):
                    blob = json.dumps(state_holder["state"], ensure_ascii=False)
                    page = f"<html><script>window.__INITIAL_STATE__={blob}</script></html>"
                    self._send(page.encode("utf-8"), "text/html; charset=utf-8")
                elif self.path.startswith("/v.mp4"):
                    self._send(VIDEO_BYTES, "video/mp4")
                else:
                    self.send_response(404)
                    self.end_headers()

        self.server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        state_holder["state"] = make_state(self.port)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> "FakeXhsServer":
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self.server.shutdown()
        self.server.server_close()


class IntegrationTests(unittest.TestCase):
    def test_download_and_skip_existing(self) -> None:
        with FakeXhsServer() as server, tempfile.TemporaryDirectory() as tmp:
            options = Options(
                output_dir=Path(tmp),
                workers=1,
                delay=0,
                save_description=True,
                retries=1,
            )
            downloader = Downloader(options)
            links = [PastedLink(url=f"http://127.0.0.1:{server.port}/note", note_id=NOTE_ID)]

            first = downloader.run(links)
            self.assertEqual(first[0].status, "ok")
            video = first[0].files[0]
            self.assertTrue(video.name.endswith(".mp4"))
            self.assertEqual(video.read_bytes(), VIDEO_BYTES)
            self.assertEqual(len(list(Path(tmp).glob("*.part"))), 0)
            self.assertEqual(len(list(Path(tmp).glob("*.txt"))), 1)

            second = downloader.run(links)
            self.assertEqual(second[0].status, "ok")
            self.assertEqual(len(list(Path(tmp).glob("*.mp4"))), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
