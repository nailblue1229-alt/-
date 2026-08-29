#!/usr/bin/env python3
"""더블클릭용 실행기: 붙여넣기 GUI를 띄웁니다.

PyInstaller로 묶인 앱에서도 이 파일이 진입점입니다.
"""

import sys
from pathlib import Path

if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent))


def report(message: str) -> None:
    """콘솔이 없는 앱에서도 오류가 보이도록 창으로도 알립니다."""
    if sys.stdout is not None:
        print(message)
    try:
        import tkinter
        from tkinter import messagebox

        root = tkinter.Tk()
        root.withdraw()
        messagebox.showerror("XHS 다운로더", message)
        root.destroy()
    except Exception:
        pass


def main() -> int:
    try:
        from xhs_dl.gui import main as gui_main
    except ImportError as exc:
        report(
            f"GUI를 열 수 없습니다: {exc}\n\n"
            "리눅스라면 'sudo apt install python3-tk' 로 tkinter를 설치하세요.\n"
            "또는 명령줄로 사용하세요:  python3 -m xhs_dl -i links.txt"
        )
        return 1
    return gui_main()


if __name__ == "__main__":
    raise SystemExit(main())
