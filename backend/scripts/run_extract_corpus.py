# -*- coding: utf-8 -*-
"""run_extract_corpus.py — ④a 跨语言等价验证（Python 侧 · 权威实现）

import 后端权威实现 `asset_code_match.extract_serial_from_brand`，对共享语料
`miniapp/tests/fixtures/extract_corpus.json` 逐条跑，输出
`backend/scripts/_extract_py.json`（[{id, brand_model, serial}]）。
产物须与 JS 侧 `miniapp/tests/_extract_js.json` **逐字节一致**。

运行（在 miniapp 或 backend 任一处）：
  PYTHONPATH=<site-packages> python run_extract_corpus.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)  # .../inspection-system/backend
sys.path.insert(0, BACKEND)

from asset_code_match import extract_serial_from_brand  # noqa: E402

CORPUS = r"C:/Users/yan/WorkBuddy/2026-05-10-task-6/miniapp/tests/fixtures/extract_corpus.json"
OUT = os.path.join(HERE, "_extract_py.json")


def main():
    with open(CORPUS, encoding="utf-8") as f:
        corpus = json.load(f)
    out = [
        {
            "id": it["id"],
            "brand_model": it["brand_model"],
            "serial": extract_serial_from_brand(it["brand_model"]),
        }
        for it in corpus
    ]
    # newline="\n"：避免 Windows 文本模式把 \n 翻成 \r\n，保证与 JS 产物逐字节一致
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    sys.stdout.write(f"PY: {len(out)} cases -> {OUT}\n")


if __name__ == "__main__":
    main()
