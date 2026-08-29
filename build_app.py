#!/usr/bin/env python3
"""PyInstaller build script: makes an app that runs without Python installed.

Windows/Linux: dist/XHS-Downloader/  - folder with the launcher inside
macOS:         dist/XHS-Downloader.app - app bundle

The build is intentionally onedir, not onefile: a self-extracting onefile
exe is a common antivirus false-positive trigger.

Messages here are ASCII only: the Windows CI console uses cp1252 and
would raise UnicodeEncodeError on non-ASCII output.
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
        print("PyInstaller not found. Run: pip install pyinstaller")
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
        "--windowed",  # no console window, GUI only
        "--collect-submodules",
        "xhs_dl",  # include submodules imported lazily
        "--paths",
        str(ROOT),
    ]
    # Always onedir. A onefile exe unpacks itself into %TEMP% at startup,
    # which antivirus heuristics (ALYac, V3, Defender) routinely flag as
    # malware. A plain folder build avoids that behaviour entirely.
    command.append(str(ROOT / "run_gui.py"))

    print("running:", " ".join(command))
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode != 0:
        return result.returncode

    print("\nbuild finished. dist contents:")
    for item in sorted((ROOT / "dist").iterdir()):
        print("  -", item.name)
    return 0


if __name__ == "__main__":
    if sys.stdout is not None:
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass
    raise SystemExit(build())
