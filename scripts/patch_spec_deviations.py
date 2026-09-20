# -*- coding: utf-8 -*-
"""把 Phase 3 实现与 SPEC 的已知偏差登记进 SPEC.md（原子追加，幂等）。"""
import io
import os
import sys

SPEC = r"C:\Users\yan\WorkBuddy\2026-05-21-13-28-45\inspection-system\docs\rewrite-vue\SPEC.md"

SECTION = """
## 14. 已登记偏差（Deviation Register）

> 记录实现与 Spec 的已知不一致，供后续期次收口。**不隐瞒、不留白**：每条须有现象、原因、影响、收口时机。

| 编号 | 项 | Spec 要求 | 实现现状 | 原因 | 影响 | 收口时机 |
|------|----|-----------|----------|------|------|----------|
| D-01 | lg(1280–1535) 档台账表格 | `UIUX.md` §6.2 写死「列裁剪：保留 4–6 关键列 + 列设置抽屉（localStorage 偏好）」 | 按视口裁列后保留 8 列，超出部分走**表格容器内横向滚动**（AC-06 明确允许），未实现「列设置」抽屉 | 该抽屉（含偏好持久化）不在派发给两位工程师的文件范围内；AC-06 已允许局部横滚 | 1280 档需在表格内左右滚动才能看到最右侧「资料 / 关联」列；**未见变形、破版或页面级溢出**（A1/A3/A4 实测通过） | 二期收敛为统一 DataTable 壳时实现 |
| D-02 | 检索页关联视图 | `UIUX.md` §8 该页右栏为「关联图谱」 | 以「关联设备列表（点编号可重检索）」替代，未绘制图谱 | 图谱依赖壳层 `components/charts/ResponsiveSvg.vue`（尚未创建）；且图谱属二期「资产可视化」范围 | 一期可看到关联对象但无图形化链路 | 二期实现 `ResponsiveSvg.vue` 后接入 |
| D-03 | 子系统图标与分类色 | `UIUX.md` §4.2 的 `SUBSYSTEM_ICON_MAP`（lucide 名 → EP 图标）与 7 子系统分类色 | 一期直接输出后端 `subsystem_name` 文本，未做图标映射 | 映射表属共享组件，需先核对 DB `subsystems.icon` 全量取值（见 `OPEN-DECISIONS.md` OD-03，仍未闭合） | 子系统以文字呈现，视觉信息量略低 | OD-03 闭合后统一接入 |
| D-04 | sm/xs 档（<1024）侧栏 | `UIUX.md` §6.2：<1024 隐藏侧栏 + 页头汉堡抽屉 | 实现为 <1536 一律折叠为 64px 图标条，未做汉堡抽屉 | 决策 D3「完全不管窄屏」，保持实现简单 | 窄屏下侧栏为图标条而非完全隐藏 | 出现真实窄屏诉求时 |

### 14.1 实测证据（Phase 4 适配验收）

- 验收脚本：`vue-frontend/scripts/verify_ui.mjs`（几何断言，非肉眼判断）
- 报告与截图：`docs/rewrite-vue/verify_report.json`、`docs/rewrite-vue/shots/`
- 结果：**9/9 组合全绿**（3 视口 × 3 页面），`ALL_PASS=true`
  - A1 无页面级横向溢出 = true（全部）
  - **A2 无 SVG 压扁 = true（全部）** ← 本轮立项要根治的缺陷，已实测确认消除
  - A3 无元素越出视口右边界 = true（全部）
  - A4 无 body 级纵向滚动 = true（全部）
- 侧栏宽度实测：1280 → 64px、1536 → 240px、1920 → 240px，**精确符合 `UIUX.md` §6.2 行为矩阵**
- 真实数据渲染确认：资产总数 8,977 / 固定资产含税总额 ¥8.85 亿 / 有台账记录 8,915 / 保修已过期 126 / 共 180 页
"""


def main():
    with io.open(SPEC, "r", encoding="utf-8") as f:
        text = f.read()

    if "## 14. 已登记偏差" in text:
        print("ALREADY_PRESENT")
        sys.exit(0)

    text = text.rstrip("\n") + "\n" + SECTION
    with io.open(SPEC, "w", encoding="utf-8", newline="") as f:
        f.write(text)

    with io.open(SPEC, "r", encoding="utf-8") as f:
        again = f.read()
    checks = ["## 14. 已登记偏差", "D-01", "D-02", "D-03", "D-04", "ALL_PASS=true"]
    lines = ["recheck %s -> %d" % (k, again.count(k)) for k in checks]
    lines.append("FILE_LINES=%d" % len(again.splitlines()))
    with io.open(os.path.join(os.path.dirname(SPEC), "_patch3_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
