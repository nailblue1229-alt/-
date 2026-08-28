#!/usr/bin/env python3
"""대본 글자수 검증 — 공백 제외 기준. 대본을 고칠 때마다 이 스크립트를 다시 돌린다.

  python3 09_글자수검증.py

주의: bash의 wc -m은 한글을 바이트로 세어 실제보다 3배 가까이 나온다. 절대 쓰지 않는다.
"""
import re
import sys
import pathlib

TARGET = 8093          # 참고 대본 3편 평균 (5,521 / 8,463 / 10,294)
TOLERANCE = 0.03       # ±3%

# 각 부의 시작 문장. 대본을 고쳐 이 문장이 바뀌면 여기도 같이 고칠 것.
ANCHORS = [
    ("1부 도입 — 밑지는 장사였다", "6년입니다."),
    ("2부 넉 달 연속 흑자",        "먼저 숫자부터 정확히 보겠습니다."),
    ("3부 머릿수가 아니라 씀씀이", "자, 그럼 도대체 뭐가 달라진 걸까요?"),
    ("4부 새로 열린 지갑 세 개",   "자, 그럼 이 늘어난 돈은 도대체 어디서 나온 걸까요?"),
    ("5부 관광은 수출이다",        "여기서 조금 더 깊은 이야기를 해 보겠습니다."),
    ("6부 경계 네 가지",           "여기까지 들으시면서 기분이 꽤 좋으셨을 겁니다."),
    ("7부 다음은 하루다",          "자, 그럼 앞으로 뭘 해야 할까요?"),
    ("8부 마무리",                 "오늘 이야기를 한 줄로 정리해 보겠습니다."),
]


def count(text):
    return len(re.sub(r"\s", "", text))


def main():
    path = pathlib.Path(__file__).parent / "01_대본.md"
    text = path.read_text(encoding="utf-8")

    positions = []
    for name, anchor in ANCHORS:
        idx = text.find(anchor)
        if idx < 0:
            sys.exit(f"[오류] 앵커 문장을 못 찾음: {name} / '{anchor}'")
        positions.append((name, idx))

    print(f"{'구간':<28}{'글자수':>8}{'비중':>8}")
    print("-" * 44)
    total = count(text)
    for i, (name, idx) in enumerate(positions):
        end = positions[i + 1][1] if i + 1 < len(positions) else len(text)
        n = count(text[idx:end])
        print(f"{name:<28}{n:>8,}{n / total * 100:>7.1f}%")

    lo, hi = int(TARGET * (1 - TOLERANCE)), int(TARGET * (1 + TOLERANCE))
    print("-" * 44)
    print(f"{'전체 (공백 제외)':<28}{total:>8,}")
    print(f"목표 {TARGET:,}자 / 허용 {lo:,}~{hi:,}자")
    if lo <= total <= hi:
        print("판정: 통과")
        return 0
    diff = total - (hi if total > hi else lo)
    print(f"판정: 미달/초과 — {abs(diff):,}자 {'줄여야' if diff > 0 else '늘려야'} 함")
    return 1


if __name__ == "__main__":
    sys.exit(main())
