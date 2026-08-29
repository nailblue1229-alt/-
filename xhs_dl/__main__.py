"""`python -m xhs_dl` 진입점.

인자 없이 실행하고 터미널 입력이 비어 있으면 GUI를 띄웁니다.
"""

from __future__ import annotations

import sys


def main() -> int:
    from .cli import main as cli_main

    argv = sys.argv[1:]
    if not argv and sys.stdin.isatty():
        try:
            from .gui import main as gui_main
        except ImportError:
            print("GUI(tkinter)를 사용할 수 없습니다. 사용법은 --help 를 참고하세요.")
            return cli_main(["--help"])
        return gui_main()
    return cli_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
