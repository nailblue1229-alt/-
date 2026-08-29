#!/usr/bin/env python3
"""더블클릭용 실행기: 붙여넣기 GUI를 띄웁니다."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if __name__ == "__main__":
    try:
        from xhs_dl.gui import main
    except ImportError as exc:  # tkinter 미설치 등
        print(f"GUI를 열 수 없습니다: {exc}")
        print("리눅스라면 'sudo apt install python3-tk' 로 tkinter를 설치하세요.")
        print("또는 명령줄로 사용하세요:  python3 -m xhs_dl -i links.txt")
        input("엔터를 누르면 종료합니다…")
        raise SystemExit(1)
    raise SystemExit(main())
