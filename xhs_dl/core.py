"""링크 목록을 받아 실제로 내려받는 핵심 로직."""

from __future__ import annotations

import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

from .extract import ExtractError, Note, parse_note
from .http import Client, HttpError
from .links import PastedLink, extract_links, note_id_from_url

ILLEGAL_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
WHITESPACE_RE = re.compile(r"\s+")
MAX_NAME_LEN = 80


def safe_filename(text: str, fallback: str = "xhs") -> str:
    """윈도우/맥/리눅스 모두에서 안전한 파일명 조각으로 정리합니다."""
    name = unicodedata.normalize("NFC", text or "")
    name = ILLEGAL_CHARS_RE.sub(" ", name)
    name = WHITESPACE_RE.sub(" ", name).strip(" .")
    if len(name) > MAX_NAME_LEN:
        name = name[:MAX_NAME_LEN].rstrip(" .")
    return name or fallback


def unique_path(path: Path) -> Path:
    """같은 이름이 있으면 `이름 (2).mp4` 처럼 번호를 붙입니다."""
    if not path.exists():
        return path
    stem, suffix = path.stem, path.suffix
    for index in range(2, 1000):
        candidate = path.with_name(f"{stem} ({index}){suffix}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{stem} ({int(time.time())}){suffix}")


def media_extension(url: str, default: str) -> str:
    tail = url.split("?", 1)[0].rsplit("/", 1)[-1]
    if "." in tail:
        ext = "." + tail.rsplit(".", 1)[-1].lower()
        if 2 <= len(ext) <= 6 and ext[1:].isalnum():
            return ext
    return default


@dataclass
class Options:
    """다운로드 동작 설정."""

    output_dir: Path = Path("downloads")
    cookie: str = ""
    download_images: bool = True
    save_description: bool = False
    skip_existing: bool = True
    workers: int = 3
    delay: float = 0.8
    timeout: float = 20.0
    retries: int = 3


@dataclass
class Result:
    """링크 하나의 처리 결과."""

    index: int
    url: str
    note_id: str = ""
    title: str = ""
    status: str = "pending"  # ok | skipped | failed
    message: str = ""
    files: list[Path] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status in ("ok", "skipped")


class Downloader:
    """붙여넣은 링크들을 순서대로(또는 병렬로) 처리합니다."""

    def __init__(
        self,
        options: Options,
        on_log: Callable[[str], None] | None = None,
        on_result: Callable[[Result], None] | None = None,
        on_progress: Callable[[int, int, int], None] | None = None,
    ) -> None:
        self.options = options
        self.on_log = on_log or (lambda message: None)
        self.on_result = on_result or (lambda result: None)
        self.on_progress = on_progress or (lambda index, received, total: None)
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.client = Client(
            cookie=options.cookie, timeout=options.timeout, retries=options.retries
        )

    def stop(self) -> None:
        self._stop.set()

    @property
    def stopped(self) -> bool:
        return self._stop.is_set()

    def _log(self, message: str) -> None:
        with self._lock:
            self.on_log(message)

    # ---- 단일 링크 처리 -------------------------------------------------

    def fetch_note(self, link: PastedLink) -> Note:
        url = link.url
        if link.is_short_link:
            url = self.client.resolve(url)
            self._log(f"    단축 링크 해제 → {url.split('?', 1)[0]}")
        page, final_url = self.client.get_text(url)
        note_id = link.note_id or note_id_from_url(final_url) or note_id_from_url(url)
        return parse_note(page, final_url, note_id, link.fallback_title)

    def _targets(self, note: Note) -> list[tuple[str, str]]:
        """(다운로드 주소, 기본 확장자) 목록."""
        if note.video_url:
            return [(note.video_url, ".mp4")]
        if self.options.download_images:
            return [(url, ".jpg") for url in note.image_urls]
        return []

    def process(self, index: int, total: int, link: PastedLink) -> Result:
        result = Result(index=index, url=link.url, note_id=link.note_id)
        label = f"[{index}/{total}]"
        if self._stop.is_set():
            result.status = "failed"
            result.message = "중단됨"
            return result

        self._log(f"{label} 정보 확인 중… {link.url.split('?', 1)[0]}")
        try:
            note = self.fetch_note(link)
        except (HttpError, ExtractError) as exc:
            result.status = "failed"
            result.message = str(exc)
            self._log(f"{label} 실패: {exc}")
            return result
        except Exception as exc:  # 예기치 못한 오류도 한 건만 실패로 처리
            result.status = "failed"
            result.message = f"알 수 없는 오류: {exc}"
            self._log(f"{label} 실패: {exc}")
            return result

        result.note_id = note.note_id or result.note_id
        result.title = note.title
        base = safe_filename(
            " ".join(part for part in (note.author, note.title) if part),
            fallback=note.note_id or f"note{index}",
        )
        targets = self._targets(note)
        if not targets:
            result.status = "skipped"
            result.message = "이미지 노트 (이미지 받기 꺼짐)"
            self._log(f"{label} 건너뜀: {result.message}")
            return result

        kind = "영상" if note.video_url else f"이미지 {len(targets)}장"
        self._log(f"{label} {kind} · {note.title[:40] or note.note_id}")

        output_dir = self.options.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        for position, (media_url, default_ext) in enumerate(targets, start=1):
            if self._stop.is_set():
                result.status = "failed"
                result.message = "중단됨"
                return result
            suffix = f"_{position:02d}" if len(targets) > 1 else ""
            filename = f"{index:03d}_{base}{suffix}{media_extension(media_url, default_ext)}"
            path = output_dir / filename

            if self.options.skip_existing and path.exists():
                result.files.append(path)
                self._log(f"{label} 이미 있음 → {path.name}")
                continue
            if not self.options.skip_existing:
                path = unique_path(path)

            try:
                self.client.download(
                    media_url,
                    path,
                    on_progress=lambda received, size: self.on_progress(index, received, size),
                    should_stop=self._stop.is_set,
                )
            except HttpError as exc:
                result.status = "failed"
                result.message = str(exc)
                self._log(f"{label} 다운로드 실패: {exc}")
                return result
            result.files.append(path)
            self._log(f"{label} 저장 완료 → {path.name}")

        if self.options.save_description and (note.desc or note.title):
            info = output_dir / f"{index:03d}_{base}.txt"
            info.write_text(
                f"제목: {note.title}\n작성자: {note.author}\n주소: {note.url}\n\n{note.desc}\n",
                encoding="utf-8",
            )
            result.files.append(info)

        result.status = "ok" if result.files else "failed"
        if not result.files:
            result.message = "저장된 파일이 없습니다."
        return result

    # ---- 전체 실행 -------------------------------------------------------

    def run(self, links: Sequence[PastedLink]) -> list[Result]:
        total = len(links)
        results: list[Result] = []
        if total == 0:
            return results

        workers = max(1, min(self.options.workers, total))
        if workers == 1:
            for index, link in enumerate(links, start=1):
                if self._stop.is_set():
                    break
                result = self.process(index, total, link)
                results.append(result)
                self.on_result(result)
                if index < total and self.options.delay > 0:
                    time.sleep(self.options.delay)
            return results

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {}
            for index, link in enumerate(links, start=1):
                futures[pool.submit(self.process, index, total, link)] = index
                if self.options.delay > 0:
                    time.sleep(self.options.delay / workers)
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                self.on_result(result)
        results.sort(key=lambda item: item.index)
        return results


def run_from_text(
    text: str,
    options: Options,
    on_log: Callable[[str], None] | None = None,
) -> list[Result]:
    """편의 함수: 붙여넣기 텍스트 → 다운로드 결과."""
    downloader = Downloader(options, on_log=on_log)
    return downloader.run(extract_links(text))
