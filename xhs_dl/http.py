"""urllib 기반의 최소 HTTP 클라이언트 (외부 패키지 불필요)."""

from __future__ import annotations

import gzip
import io
import random
import ssl
import time
import urllib.error
import urllib.request
import zlib
from typing import Callable, Iterable

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

PAGE_HEADERS = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,zh-CN;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate",
    "Upgrade-Insecure-Requests": "1",
    # 브라우저가 보내는 값들. 빠져 있으면 봇으로 보고 로그인 페이지로 넘기는
    # 경우가 있어 함께 보냅니다.
    "sec-ch-ua": '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Referer": "https://www.xiaohongshu.com/",
}

MEDIA_HEADERS = {
    "User-Agent": DEFAULT_UA,
    "Accept": "*/*",
    "Accept-Encoding": "identity",
    "Referer": "https://www.xiaohongshu.com/",
}


class HttpError(RuntimeError):
    """네트워크/HTTP 오류를 사용자에게 보여줄 수 있는 형태로 감싼 예외."""


def _decode_body(raw: bytes, encoding: str | None) -> bytes:
    encoding = (encoding or "").lower()
    if encoding == "gzip":
        try:
            return gzip.decompress(raw)
        except OSError:
            return raw
    if encoding == "deflate":
        try:
            return zlib.decompress(raw)
        except zlib.error:
            try:
                return zlib.decompress(raw, -zlib.MAX_WBITS)
            except zlib.error:
                return raw
    return raw


class Client:
    """쿠키 문자열과 재시도를 지원하는 단순 클라이언트."""

    def __init__(
        self,
        cookie: str = "",
        timeout: float = 20.0,
        retries: int = 3,
        verify_ssl: bool = True,
    ) -> None:
        self.cookie = (cookie or "").strip()
        self.timeout = timeout
        self.retries = max(1, retries)
        context = ssl.create_default_context()
        if not verify_ssl:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=context),
            urllib.request.HTTPRedirectHandler(),
        )

    def _headers(self, base: dict[str, str], extra: dict[str, str] | None) -> dict[str, str]:
        headers = dict(base)
        if self.cookie:
            headers["Cookie"] = self.cookie
        if extra:
            headers.update(extra)
        return headers

    def open(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        base_headers: dict[str, str] | None = None,
    ):
        """응답 객체를 반환합니다. 호출자가 close() 해야 합니다."""
        last_error: Exception | None = None
        for attempt in range(self.retries):
            request = urllib.request.Request(
                url, headers=self._headers(base_headers or PAGE_HEADERS, headers)
            )
            try:
                return self._opener.open(request, timeout=self.timeout)
            except urllib.error.HTTPError as exc:
                # 4xx는 재시도해도 결과가 같으므로 즉시 중단 (429 제외).
                if exc.code != 429 and 400 <= exc.code < 500:
                    raise HttpError(f"HTTP {exc.code} {exc.reason} ({url})") from exc
                last_error = exc
            except Exception as exc:  # URLError, socket.timeout, ssl 오류 등
                last_error = exc
            if attempt < self.retries - 1:
                time.sleep(1.5 * (2**attempt) + random.random())
        raise HttpError(f"요청 실패: {url} ({last_error})")

    def get_text(self, url: str, headers: dict[str, str] | None = None) -> tuple[str, str]:
        """(본문, 최종 URL) 반환."""
        response = self.open(url, headers=headers)
        try:
            raw = _decode_body(response.read(), response.headers.get("Content-Encoding"))
            final_url = response.geturl()
        finally:
            response.close()
        charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace"), final_url

    def resolve(self, url: str) -> str:
        """단축 링크(xhslink.com)의 최종 주소를 얻습니다."""
        response = self.open(url)
        try:
            return response.geturl()
        finally:
            response.close()

    def download(
        self,
        url: str,
        path,
        on_progress: Callable[[int, int], None] | None = None,
        should_stop: Callable[[], bool] | None = None,
        chunk_size: int = 262144,
    ) -> int:
        """파일로 저장하고 받은 바이트 수를 반환합니다.

        `.part` 임시 파일에 먼저 쓰고 완료 시점에만 최종 이름으로 바꿉니다.
        """
        part = path.with_name(path.name + ".part")
        part.parent.mkdir(parents=True, exist_ok=True)
        response = self.open(url, base_headers=MEDIA_HEADERS)
        try:
            total = int(response.headers.get("Content-Length") or 0)
            received = 0
            with open(part, "wb") as handle:
                while True:
                    if should_stop is not None and should_stop():
                        raise HttpError("사용자가 중단했습니다.")
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    handle.write(chunk)
                    received += len(chunk)
                    if on_progress is not None:
                        on_progress(received, total)
        except BaseException:
            part.unlink(missing_ok=True)
            raise
        finally:
            response.close()
        if total and received < total:
            part.unlink(missing_ok=True)
            raise HttpError(f"전송이 중간에 끊겼습니다 ({received}/{total} bytes)")
        part.replace(path)
        return received


def iter_lines(text: str) -> Iterable[str]:
    for line in text.splitlines():
        line = line.strip()
        if line:
            yield line
