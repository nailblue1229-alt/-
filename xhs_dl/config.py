"""사용자 설정(저장 폴더·쿠키 등)을 홈 디렉터리에 보관합니다."""

from __future__ import annotations

import json
from pathlib import Path

CONFIG_DIR = Path.home() / ".xhs_dl"
CONFIG_PATH = CONFIG_DIR / "config.json"

DEFAULTS: dict = {
    "output_dir": str(Path.home() / "Downloads" / "xiaohongshu"),
    "cookie": "",
    "download_images": True,
    "save_description": False,
    "workers": 3,
    "delay": 0.8,
}


def load() -> dict:
    data = dict(DEFAULTS)
    try:
        stored = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return data
    if isinstance(stored, dict):
        for key in DEFAULTS:
            if key in stored:
                data[key] = stored[key]
    return data


def save(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    merged = {key: data.get(key, DEFAULTS[key]) for key in DEFAULTS}
    CONFIG_PATH.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )
