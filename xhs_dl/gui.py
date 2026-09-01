"""붙여넣기용 tkinter GUI."""

from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk

from . import __version__, config
from .core import Downloader, Options, Result, failure_advice
from .links import extract_links

PLACEHOLDER = (
    "여기에 샤오홍슈 공유 텍스트를 그대로 붙여넣으세요. 몇 개든 한꺼번에 됩니다.\n\n"
    "예)\n"
    "87 [饭盒优等生…] jfHaah6nCCkXNqn https://www.xiaohongshu.com/discovery/item/…\n"
    "88 [다른 영상] http://xhslink.com/a/…\n"
)


def open_folder(path: Path) -> None:
    """탐색기/파인더로 폴더 열기."""
    path.mkdir(parents=True, exist_ok=True)
    try:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except OSError:
        pass


class App:
    """메인 창."""

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.saved = config.load()
        self.events: queue.Queue = queue.Queue()
        self.downloader: Downloader | None = None
        self.worker: threading.Thread | None = None

        root.title(f"샤오홍슈 일괄 다운로더 v{__version__}")
        root.geometry("820x760")
        root.minsize(680, 620)

        self._build_paste_area()
        self._build_settings()
        self._build_controls()
        self._build_log()

        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.after(100, self._drain_events)

    # ---- 위젯 구성 -------------------------------------------------------

    def _build_paste_area(self) -> None:
        frame = ttk.LabelFrame(self.root, text="1. 링크 붙여넣기")
        frame.pack(fill="both", expand=True, padx=10, pady=(10, 6))

        self.text = scrolledtext.ScrolledText(frame, height=12, wrap="word", undo=True)
        self.text.pack(fill="both", expand=True, padx=8, pady=8)
        self.text.insert("1.0", PLACEHOLDER)
        self._placeholder_shown = True
        self.text.bind("<FocusIn>", self._clear_placeholder)

        row = ttk.Frame(frame)
        row.pack(fill="x", padx=8, pady=(0, 8))
        ttk.Button(row, text="붙여넣기", command=self._paste_clipboard).pack(side="left")
        ttk.Button(row, text="파일에서 불러오기", command=self._load_file).pack(
            side="left", padx=6
        )
        ttk.Button(row, text="지우기", command=self._clear_text).pack(side="left")
        self.count_label = ttk.Label(row, text="링크 0개")
        self.count_label.pack(side="right")
        ttk.Button(row, text="링크 개수 확인", command=self._count_links).pack(
            side="right", padx=6
        )

    def _build_settings(self) -> None:
        frame = ttk.LabelFrame(self.root, text="2. 저장 설정")
        frame.pack(fill="x", padx=10, pady=6)

        row1 = ttk.Frame(frame)
        row1.pack(fill="x", padx=8, pady=(8, 4))
        ttk.Label(row1, text="저장 폴더").pack(side="left")
        self.dir_var = tk.StringVar(value=self.saved["output_dir"])
        ttk.Entry(row1, textvariable=self.dir_var).pack(
            side="left", fill="x", expand=True, padx=6
        )
        ttk.Button(row1, text="찾아보기", command=self._choose_dir).pack(side="left")
        ttk.Button(row1, text="폴더 열기", command=self._open_output).pack(
            side="left", padx=(6, 0)
        )

        row2 = ttk.Frame(frame)
        row2.pack(fill="x", padx=8, pady=4)
        ttk.Label(row2, text="쿠키(선택)").pack(side="left")
        self.cookie_var = tk.StringVar(value=self.saved["cookie"])
        ttk.Entry(row2, textvariable=self.cookie_var, show="•").pack(
            side="left", fill="x", expand=True, padx=6
        )
        ttk.Button(row2, text="설정 저장", command=self._save_config).pack(side="left")

        row3 = ttk.Frame(frame)
        row3.pack(fill="x", padx=8, pady=(4, 8))
        self.images_var = tk.BooleanVar(value=bool(self.saved["download_images"]))
        self.desc_var = tk.BooleanVar(value=bool(self.saved["save_description"]))
        self.skip_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(row3, text="이미지 노트도 받기", variable=self.images_var).pack(
            side="left"
        )
        ttk.Checkbutton(row3, text="제목·본문 txt 저장", variable=self.desc_var).pack(
            side="left", padx=10
        )
        ttk.Checkbutton(row3, text="이미 받은 파일 건너뛰기", variable=self.skip_var).pack(
            side="left"
        )
        ttk.Label(row3, text="동시 다운로드").pack(side="left", padx=(14, 4))
        self.workers_var = tk.IntVar(value=int(self.saved["workers"]))
        ttk.Spinbox(row3, from_=1, to=8, width=4, textvariable=self.workers_var).pack(
            side="left"
        )

    def _build_controls(self) -> None:
        frame = ttk.Frame(self.root)
        frame.pack(fill="x", padx=10, pady=(2, 6))

        self.start_button = ttk.Button(
            frame, text="3. 다운로드 시작", command=self._start
        )
        self.start_button.pack(side="left")
        self.stop_button = ttk.Button(
            frame, text="중지", command=self._stop, state="disabled"
        )
        self.stop_button.pack(side="left", padx=6)

        self.progress = ttk.Progressbar(frame, mode="determinate", maximum=100)
        self.progress.pack(side="left", fill="x", expand=True, padx=8)
        self.status_var = tk.StringVar(value="대기 중")
        ttk.Label(frame, textvariable=self.status_var, width=22, anchor="e").pack(
            side="right"
        )

    def _build_log(self) -> None:
        frame = ttk.LabelFrame(self.root, text="진행 상황")
        frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.log = scrolledtext.ScrolledText(frame, height=12, wrap="word", state="disabled")
        self.log.pack(fill="both", expand=True, padx=8, pady=8)

    # ---- 입력 도우미 -----------------------------------------------------

    def _clear_placeholder(self, _event=None) -> None:
        if self._placeholder_shown:
            self.text.delete("1.0", "end")
            self._placeholder_shown = False

    def _current_text(self) -> str:
        if self._placeholder_shown:
            return ""
        return self.text.get("1.0", "end")

    def _paste_clipboard(self) -> None:
        try:
            data = self.root.clipboard_get()
        except tk.TclError:
            return
        self._clear_placeholder()
        self.text.insert("end", data.rstrip() + "\n")
        self._count_links()

    def _load_file(self) -> None:
        path = filedialog.askopenfilename(
            title="링크 파일 선택", filetypes=[("텍스트 파일", "*.txt"), ("모든 파일", "*.*")]
        )
        if not path:
            return
        self._clear_placeholder()
        self.text.insert("end", Path(path).read_text(encoding="utf-8", errors="replace"))
        self._count_links()

    def _clear_text(self) -> None:
        self.text.delete("1.0", "end")
        self._placeholder_shown = False
        self.count_label.config(text="링크 0개")

    def _count_links(self) -> int:
        count = len(extract_links(self._current_text()))
        self.count_label.config(text=f"링크 {count}개")
        return count

    def _choose_dir(self) -> None:
        path = filedialog.askdirectory(title="저장 폴더 선택", initialdir=self.dir_var.get())
        if path:
            self.dir_var.set(path)

    def _open_output(self) -> None:
        open_folder(Path(self.dir_var.get()).expanduser())

    def _save_config(self) -> None:
        config.save(
            {
                "output_dir": self.dir_var.get(),
                "cookie": self.cookie_var.get().strip(),
                "download_images": self.images_var.get(),
                "save_description": self.desc_var.get(),
                "workers": int(self.workers_var.get()),
                "delay": self.saved.get("delay", 0.8),
            }
        )
        self._append_log(f"설정을 저장했습니다: {config.CONFIG_PATH}")

    # ---- 실행 ------------------------------------------------------------

    def _options(self) -> Options:
        return Options(
            output_dir=Path(self.dir_var.get()).expanduser(),
            cookie=self.cookie_var.get().strip(),
            download_images=self.images_var.get(),
            save_description=self.desc_var.get(),
            skip_existing=self.skip_var.get(),
            workers=max(1, int(self.workers_var.get())),
            delay=float(self.saved.get("delay", 0.8)),
        )

    def _start(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        links = extract_links(self._current_text())
        self.count_label.config(text=f"링크 {len(links)}개")
        if not links:
            messagebox.showwarning(
                "링크 없음", "샤오홍슈 링크를 찾지 못했습니다.\n공유 텍스트를 그대로 붙여넣어 주세요."
            )
            return

        options = self._options()
        try:
            options.output_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            messagebox.showerror("폴더 오류", f"저장 폴더를 만들 수 없습니다:\n{exc}")
            return

        self.progress.config(value=0)
        self._set_running(True)
        self._append_log(f"=== 링크 {len(links)}개 · {options.output_dir} ===")

        self.downloader = Downloader(
            options,
            on_log=lambda message: self.events.put(("log", message)),
            on_result=lambda result: self.events.put(("result", result)),
            on_progress=lambda index, received, total: self.events.put(
                ("progress", (index, received, total))
            ),
        )
        self.total_links = len(links)
        self.done_links = 0
        self.worker = threading.Thread(
            target=self._run_worker, args=(links,), daemon=True
        )
        self.worker.start()

    def _run_worker(self, links) -> None:
        assert self.downloader is not None
        try:
            results = self.downloader.run(links)
        except Exception as exc:  # 워커에서 죽어도 UI는 살아 있어야 합니다.
            self.events.put(("log", f"예기치 못한 오류: {exc}"))
            results = []
        self.events.put(("done", results))

    def _stop(self) -> None:
        if self.downloader is not None:
            self.downloader.stop()
            self._append_log("중지 요청… 진행 중인 파일이 끝나면 멈춥니다.")
        self.stop_button.config(state="disabled")

    def _set_running(self, running: bool) -> None:
        self.start_button.config(state="disabled" if running else "normal")
        self.stop_button.config(state="normal" if running else "disabled")
        self.status_var.set("다운로드 중…" if running else "대기 중")

    # ---- 이벤트 펌프 -----------------------------------------------------

    def _append_log(self, message: str) -> None:
        self.log.config(state="normal")
        self.log.insert("end", message + "\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def _drain_events(self) -> None:
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "log":
                    self._append_log(str(payload))
                elif kind == "progress":
                    _, received, total = payload
                    if total > 0:
                        self.progress.config(value=received * 100 / total)
                        self.status_var.set(
                            f"{received / 1048576:.1f} / {total / 1048576:.1f} MB"
                        )
                    else:
                        self.status_var.set(f"{received / 1048576:.1f} MB")
                elif kind == "result":
                    self.done_links += 1
                    self.status_var.set(f"{self.done_links}/{self.total_links} 완료")
                elif kind == "done":
                    self._finish(payload)
        except queue.Empty:
            pass
        self.root.after(100, self._drain_events)

    def _finish(self, results: list[Result]) -> None:
        self._set_running(False)
        self.progress.config(value=0)
        ok = sum(1 for result in results if result.status == "ok")
        skipped = sum(1 for result in results if result.status == "skipped")
        failed = [result for result in results if result.status == "failed"]
        self._append_log(f"=== 완료: 성공 {ok} · 건너뜀 {skipped} · 실패 {len(failed)} ===")
        for result in failed:
            self._append_log(f"  실패 [{result.index}] {result.url} → {result.message}")
        advice = failure_advice(results, self.cookie_var.get().strip())
        if advice:
            self._append_log(f"※ {advice}")
            self._append_log(f"   서버 응답 원본: {self._options().output_dir / '_debug'}")
        self.status_var.set(f"완료 (성공 {ok} / 실패 {len(failed)})")

    def _on_close(self) -> None:
        if self.worker and self.worker.is_alive():
            if not messagebox.askokcancel("종료", "다운로드가 진행 중입니다. 종료할까요?"):
                return
            if self.downloader is not None:
                self.downloader.stop()
        self.root.destroy()


def main() -> int:
    root = tk.Tk()
    try:
        ttk.Style().theme_use("clam")
    except tk.TclError:
        pass
    App(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
