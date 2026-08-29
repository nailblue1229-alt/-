"""붙여넣은 텍스트 덩어리에서 샤오홍슈 링크를 뽑아냅니다."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

URL_RE = re.compile(r"https?://[^\s\"'<>\\]+", re.IGNORECASE)
TITLE_RE = re.compile(r"\[([^\[\]]{2,200})\]")
NOTE_ID_RE = re.compile(
    r"/(?:explore|discovery/item|item)/([0-9a-fA-F]{16,32})"
    r"|/user/profile/[0-9a-fA-F]{16,32}/([0-9a-fA-F]{16,32})"
)
BARE_ID_RE = re.compile(r"\b([0-9a-f]{24})\b")

XHS_HOSTS = ("xiaohongshu.com", "xhslink.com", "xhscdn.com")
TRAILING_JUNK = "，。、）】」』,.;:!?)]}〉》…"


def _clean_url(raw: str) -> str:
    url = raw.strip()
    while url and url[-1] in TRAILING_JUNK:
        url = url[:-1]
    return url


def is_xhs_url(url: str) -> bool:
    lowered = url.lower()
    return any(host in lowered for host in XHS_HOSTS)


def note_id_from_url(url: str) -> str:
    match = NOTE_ID_RE.search(url)
    if not match:
        return ""
    return (match.group(1) or match.group(2) or "").lower()


def token_from_url(url: str) -> str:
    match = re.search(r"[?&]xsec_token=([^&\s]+)", url)
    return match.group(1) if match else ""


@dataclass
class PastedLink:
    """붙여넣기 텍스트에서 찾아낸 링크 하나."""

    url: str
    note_id: str = ""
    fallback_title: str = ""
    source_line: str = field(default="", repr=False)

    @property
    def key(self) -> str:
        return self.note_id or self.url.split("?", 1)[0]

    @property
    def is_short_link(self) -> bool:
        return "xhslink.com" in self.url.lower()


def clean_title_fragment(text: str) -> str:
    """공유 텍스트의 `[제목 - 작성자| 小红书 ...]`에서 제목만 남깁니다."""
    title = text.strip()
    for separator in ("|", "｜"):
        if separator in title:
            title = title.split(separator, 1)[0]
    title = re.split(r"\s+-\s+", title)[0]
    return title.strip(" -–—#")


def extract_links(text: str) -> list[PastedLink]:
    """붙여넣은 텍스트에서 샤오홍슈 링크를 중복 없이 순서대로 추출합니다.

    한 줄에 번호·제목·토큰·URL이 뒤섞여 있어도, 여러 줄이 이어 붙어 있어도
    URL 단위로 찾아내므로 그대로 붙여넣으면 됩니다.
    """
    found: list[PastedLink] = []
    seen: set[str] = set()

    for line in text.splitlines():
        title_match = TITLE_RE.search(line)
        fallback_title = clean_title_fragment(title_match.group(1)) if title_match else ""
        urls = [_clean_url(raw) for raw in URL_RE.findall(line)]
        urls = [url for url in urls if url and is_xhs_url(url)]

        for url in urls:
            link = PastedLink(
                url=url,
                note_id=note_id_from_url(url),
                fallback_title=fallback_title,
                source_line=line.strip(),
            )
            if link.key in seen:
                continue
            seen.add(link.key)
            found.append(link)

        if urls:
            continue

        # URL 없이 노트 ID만 붙여넣은 경우도 받아 줍니다.
        for note_id in BARE_ID_RE.findall(line):
            if note_id in seen:
                continue
            seen.add(note_id)
            found.append(
                PastedLink(
                    url=f"https://www.xiaohongshu.com/explore/{note_id}",
                    note_id=note_id,
                    fallback_title=fallback_title,
                    source_line=line.strip(),
                )
            )

    return found
