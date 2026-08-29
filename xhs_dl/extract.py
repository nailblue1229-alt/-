"""노트 페이지 HTML에서 영상/이미지 주소와 메타데이터를 뽑아냅니다."""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, field

STATE_MARKER_RE = re.compile(r"window\.__INITIAL_STATE__\s*=\s*")
MASTER_URL_RE = re.compile(r'"masterUrl"\s*:\s*"(https?:[^"]+)"')
OG_VIDEO_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\']og:video["\'][^>]+content=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
OG_TITLE_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\']og:title["\'][^>]+content=["\']([^"\']*)["\']',
    re.IGNORECASE,
)
CDN_VIDEO_RE = re.compile(r'"(https?://sns-video[^"]+?\.(?:mp4|m3u8)[^"]*)"')
LOGIN_HINTS = ("登录后查看", "扫码登录", "请先登录", "captcha", "验证码")


class ExtractError(RuntimeError):
    """페이지에서 미디어 주소를 찾지 못했을 때."""


@dataclass
class Note:
    """노트 하나의 다운로드 정보."""

    note_id: str
    url: str
    title: str = ""
    author: str = ""
    desc: str = ""
    kind: str = "unknown"  # "video" | "image"
    video_url: str = ""
    image_urls: list[str] = field(default_factory=list)

    @property
    def media_count(self) -> int:
        return 1 if self.video_url else len(self.image_urls)


def _find_state_json(page: str) -> dict | None:
    """`window.__INITIAL_STATE__ = {...}` 객체를 괄호 균형으로 잘라 파싱합니다."""
    match = STATE_MARKER_RE.search(page)
    if not match:
        return None
    start = page.find("{", match.end())
    if start < 0:
        return None

    depth = 0
    in_string = False
    escaped = False
    end = -1
    for index in range(start, len(page)):
        char = page[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end < 0:
        return None

    blob = page[start:end]
    # 샤오홍슈는 JSON이 아닌 JS 리터럴이라 undefined가 섞여 있습니다.
    blob = re.sub(r"(?<![\w\"])undefined(?![\w\"])", "null", blob)
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        return None


def _pick_video_url(video: dict) -> str:
    stream = ((video.get("media") or {}).get("stream")) or {}
    candidates: list[str] = []
    for codec in ("h264", "h265", "h266", "av1"):
        for item in stream.get(codec) or []:
            if not isinstance(item, dict):
                continue
            if item.get("masterUrl"):
                candidates.append(item["masterUrl"])
            for backup in item.get("backupUrls") or []:
                if backup:
                    candidates.append(backup)
    if candidates:
        return candidates[0]

    consumer = (video.get("consumer") or {}).get("originVideoKey")
    if consumer:
        return f"https://sns-video-bd.xhscdn.com/{consumer}"
    return ""


def _pick_image_urls(image_list: list) -> list[str]:
    urls: list[str] = []
    for item in image_list or []:
        if not isinstance(item, dict):
            continue
        chosen = ""
        # 무손실에 가까운 원본(WB_DFT)을 우선합니다.
        for info in item.get("infoList") or []:
            if not isinstance(info, dict):
                continue
            if info.get("imageScene") == "WB_DFT" and info.get("url"):
                chosen = info["url"]
                break
        if not chosen:
            for key in ("urlDefault", "urlPre", "url"):
                if item.get(key):
                    chosen = item[key]
                    break
        if chosen:
            urls.append(chosen.split("?")[0] if "!" not in chosen else chosen)
    return urls


def _note_payload(state: dict, note_id: str) -> tuple[dict, str]:
    detail_map = ((state.get("note") or {}).get("noteDetailMap")) or {}
    if note_id and note_id in detail_map:
        entry = detail_map[note_id]
        if isinstance(entry, dict) and isinstance(entry.get("note"), dict):
            return entry["note"], note_id
    for key, entry in detail_map.items():
        if isinstance(entry, dict) and isinstance(entry.get("note"), dict):
            return entry["note"], key
    return {}, note_id


def parse_note(page: str, url: str, note_id: str = "", fallback_title: str = "") -> Note:
    """노트 페이지 HTML을 Note 로 변환합니다."""
    note = Note(note_id=note_id, url=url, title=fallback_title)

    state = _find_state_json(page)
    payload: dict = {}
    if state:
        payload, resolved_id = _note_payload(state, note_id)
        if resolved_id:
            note.note_id = resolved_id

    if payload:
        note.title = (payload.get("title") or "").strip() or note.title
        note.desc = (payload.get("desc") or "").strip()
        note.author = ((payload.get("user") or {}).get("nickname") or "").strip()
        note.video_url = _pick_video_url(payload.get("video") or {})
        note.image_urls = _pick_image_urls(payload.get("imageList") or [])
        note.kind = "video" if note.video_url else ("image" if note.image_urls else "unknown")

    if not note.video_url:
        # 상태 JSON을 못 읽은 경우를 대비한 대체 경로.
        for pattern in (MASTER_URL_RE, OG_VIDEO_RE, CDN_VIDEO_RE):
            match = pattern.search(page)
            if match:
                note.video_url = html.unescape(match.group(1)).replace("\\u002F", "/")
                note.kind = "video"
                break

    if not note.title:
        match = OG_TITLE_RE.search(page)
        if match:
            note.title = html.unescape(match.group(1)).strip()

    if not note.video_url and not note.image_urls:
        if any(hint in page for hint in LOGIN_HINTS):
            raise ExtractError(
                "로그인이 필요하거나 인증(캡차)이 걸린 노트입니다. 쿠키를 설정한 뒤 다시 시도하세요."
            )
        raise ExtractError("영상/이미지 주소를 찾지 못했습니다. 링크가 만료되었을 수 있습니다.")

    return note
