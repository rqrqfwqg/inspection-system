# -*- coding: utf-8 -*-
"""把用户 2026-09-17 的三条决策冻结进 PRD.md（原子替换 + 断言命中数）。

背景：本机 Edit 工具对同一文件的多次并发编辑会互相覆盖（实测 7 个编辑只落盘 1 个），
故改用本脚本一次性完成，并对每处替换断言「恰好命中 1 次」，命中数不为 1 即整体不写盘。
"""
import io
import os
import sys

BASE = r"C:\Users\yan\WorkBuddy\2026-05-21-13-28-45\inspection-system\docs\rewrite-vue"
TARGET = os.path.join(BASE, "PRD.md")
REPORT = os.path.join(BASE, "_patch_report.txt")

FREEZE = """## 决策冻结（2026-09-17 用户拍板 —— 优先级高于本文其余章节）

| # | 决策项 | 用户裁定 | 对本文其余章节的效力 |
|---|--------|----------|----------------------|
| D1 | 功能范围 | **全量等价迁移**：13 条路由 + 9 个子视图一个不少，只换技术栈、不改功能边界 | §5「判定」列中一切"应该合并 / 可以在重写中砍掉"**全部作废**，一律按**必须保留**执行；§6 RICE 与 §7 的"砍/Backlog"仅作排序参考，**不代表可删功能** |
| D2 | 交付节奏 | **先只做一期**（全局壳 + 资产总台账 + 检索），三种缩放下零变形验收通过后再决定后续期次 | §7 分期表：一期即准入范围；二期/三期标为**暂缓**，待一期验收后重新评估（不是取消） |
| D3 | 窄屏/移动端 | **完全不管窄屏**，只保证 ≥1280×720 桌面视口 | §8 与 §11 的移动端/窄屏条款按此收口；现场扫码由既有微信小程序承担，Web 端不重复投入 |

---

"""

# (旧串, 新串, 说明)
EDITS = [
    ("状态：待评审",
     "状态：已确认（2026-09-17 项目总监冻结）",
     "版本行状态"),
    ("## 0. 一句话目标",
     FREEZE + "## 0. 一句话目标",
     "插入决策冻结块"),
    ("其余全部进 Backlog。",
     "其余**全部暂缓**（决策 D2：不是砍掉，一期验收通过后重新评估期次）。",
     "§7 MVP 说明"),
    ("| **二期** |",
     "| **二期（暂缓，待一期验收）** |",
     "§7 二期行"),
    ("| **三期（暂缓，待一期验收）** |",
     "| **三期（暂缓，待一期验收）** |",
     "§7 三期行（幂等占位）"),
    ("菜单已隐藏、Reach 最低、无使用证据 |",
     "决策 D1：全量等价迁移，路由与页面保留（菜单显示沿用现状） |",
     "§8 第 4 行 CAD"),
    ("| 5 | 移动端原生 App / 小程序 | 本次仅 Web SPA |",
     "| 5 | 窄屏（<1280px）移动端排布 / 移动端 App | 决策 D3：只保证 ≥1280×720 桌面视口，窄屏不适配；现场扫码由既有微信小程序承担 |",
     "§8 第 5 行移动端"),
]


def main():
    with io.open(TARGET, "r", encoding="utf-8") as f:
        text = f.read()

    lines = []
    ok = True
    for old, new, desc in EDITS:
        n = text.count(old)
        lines.append("count=%d  %s" % (n, desc))
        if n != 1:
            ok = False
            continue
        text = text.replace(old, new, 1)

    lines.append("ALL_ASSERTIONS_PASSED=%s" % ok)
    if not ok:
        lines.append("NOT WRITTEN (assertion failed)")
        with io.open(REPORT, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        sys.exit(1)

    with io.open(TARGET, "w", encoding="utf-8", newline="") as f:
        f.write(text)

    # 写后复检：读回磁盘确认关键标记存在
    with io.open(TARGET, "r", encoding="utf-8") as f:
        again = f.read()
    checks = [
        ("决策冻结", "决策冻结块"),
        ("全量等价迁移", "D1"),
        ("决策 D3", "D3"),
        ("全部暂缓", "D2 暂缓"),
        ("二期（暂缓，待一期验收）", "二期标记"),
    ]
    for key, desc in checks:
        lines.append("recheck %s -> %d" % (desc, again.count(key)))
    lines.append("FILE_LINES=%d" % len(again.splitlines()))

    with io.open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
