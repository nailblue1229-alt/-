"""명령줄 인터페이스."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__, config
from .core import Downloader, Options, failure_advice
from .links import extract_links


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="xhs-dl",
        description="샤오홍슈(小红书) 링크를 한꺼번에 붙여넣어 영상·이미지를 내려받습니다.",
        epilog=(
            "예시:\n"
            "  python -m xhs_dl --gui                 GUI 실행 (붙여넣기 창)\n"
            "  python -m xhs_dl -i links.txt          파일에 모아둔 링크 일괄 처리\n"
            "  cat links.txt | python -m xhs_dl       표준 입력으로 붙여넣기\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("links", nargs="*", help="링크(또는 링크가 섞인 텍스트)")
    parser.add_argument("-i", "--input", help="링크가 들어 있는 텍스트 파일")
    parser.add_argument("-o", "--out", help="저장 폴더 (기본: 설정값)")
    parser.add_argument("--cookie", default="", help="로그인 쿠키 문자열")
    parser.add_argument("--cookie-file", help="쿠키 문자열이 든 파일")
    parser.add_argument("--no-images", action="store_true", help="이미지 노트는 건너뛰기")
    parser.add_argument("--desc", action="store_true", help="제목·본문을 .txt로 함께 저장")
    parser.add_argument("--overwrite", action="store_true", help="같은 파일이 있어도 새로 받기")
    parser.add_argument("--workers", type=int, help="동시 다운로드 개수 (기본 3)")
    parser.add_argument("--delay", type=float, help="요청 간 간격(초, 기본 0.8)")
    parser.add_argument("--list", action="store_true", help="찾은 링크만 출력하고 종료")
    parser.add_argument("--gui", action="store_true", help="붙여넣기 GUI 실행")
    parser.add_argument("--version", action="version", version=f"xhs-dl {__version__}")
    return parser


def read_input_text(args: argparse.Namespace) -> str:
    chunks: list[str] = []
    if args.input:
        chunks.append(Path(args.input).read_text(encoding="utf-8", errors="replace"))
    if args.links:
        chunks.append("\n".join(args.links))
    if not chunks and not sys.stdin.isatty():
        chunks.append(sys.stdin.read())
    return "\n".join(chunks)


def build_options(args: argparse.Namespace, saved: dict) -> Options:
    cookie = args.cookie
    if args.cookie_file:
        cookie = Path(args.cookie_file).read_text(encoding="utf-8").strip()
    return Options(
        output_dir=Path(args.out or saved["output_dir"]).expanduser(),
        cookie=cookie or saved["cookie"],
        download_images=not args.no_images and saved["download_images"],
        save_description=args.desc or saved["save_description"],
        skip_existing=not args.overwrite,
        workers=args.workers or int(saved["workers"]),
        delay=saved["delay"] if args.delay is None else args.delay,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.gui:
        from .gui import main as gui_main

        return gui_main()

    text = read_input_text(args)
    links = extract_links(text)
    if not links:
        print("샤오홍슈 링크를 찾지 못했습니다. 공유 텍스트를 그대로 붙여넣어 주세요.")
        return 1

    if args.list:
        for index, link in enumerate(links, start=1):
            print(f"{index:3d}. {link.note_id or '-'}  {link.url}")
        return 0

    options = build_options(args, config.load())
    print(f"링크 {len(links)}개 · 저장 폴더: {options.output_dir}")

    downloader = Downloader(options, on_log=print)
    try:
        results = downloader.run(links)
    except KeyboardInterrupt:
        downloader.stop()
        print("\n사용자가 중단했습니다.")
        return 130

    ok = sum(1 for result in results if result.status == "ok")
    skipped = sum(1 for result in results if result.status == "skipped")
    failed = [result for result in results if result.status == "failed"]
    print(f"\n완료: 성공 {ok} · 건너뜀 {skipped} · 실패 {len(failed)}")
    for result in failed:
        print(f"  - [{result.index}] {result.url.split('?', 1)[0]} → {result.message}")
    advice = failure_advice(results, options.cookie)
    if advice:
        print(f"\n※ {advice}")
        print(f"   서버 응답 원본: {options.output_dir / '_debug'}")
    return 0 if not failed else 2


if __name__ == "__main__":
    raise SystemExit(main())
