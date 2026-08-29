#!/usr/bin/env python3
"""PyInstaller로 파이썬 없이 실행되는 앱을 만듭니다.

윈도우/리눅스: dist/XHS-Downloader(.exe) 단일 파일
맥:            dist/XHS-Downloader.app 앱 번들
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

APP_NAME = "XHS-Downloader"
ROOT = Path(__file__).resolve().parent


def build() -> int:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("PyInstaller가 없습니다.  pip install pyinstaller  후 다시 실행하세요.")
        return 1

    for folder in ("build", "dist"):
        shutil.rmtree(ROOT / folder, ignore_errors=True)

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--name",
        APP_NAME,
        "--windowed",  # 콘솔 창 없이 GUI만 띄웁니다.
        "--collect-submodules",
        "xhs_dl",  # 동적으로 불러오는 하위 모듈까지 포함
        "--paths",
        str(ROOT),
    ]
    if sys.platform != "darwin":
        # 맥은 .app 번들(onedir)이 안정적이라 onefile을 쓰지 않습니다.
        command.append("--onefile")
    command.append(str(ROOT / "run_gui.py"))

    print("실행:", " ".join(command))
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode != 0:
        return result.returncode

    print("\n빌드 완료. dist 폴더 내용:")
    for item in sorted((ROOT / "dist").iterdir()):
        print("  -", item.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(build())
