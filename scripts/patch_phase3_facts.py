# -*- coding: utf-8 -*-
"""Phase 3 开工前的事实纠偏（原子替换 + 断言命中数）。

两处纠偏：
1) Spec 里把「路由数 13」误写成「菜单项 13」——React 版 Sidebar.tsx 实际只有 9 个菜单项。
2) design-tokens.css / ARCHITECTURE.md 规定「禁止 import 'element-plus/dist/index.css'」，
   但用户既有 Vue 工程 tools-management/vue-frontend/src/main.ts:6 正是直接 import 该文件
   且已在生产稳定运行；overriding --el-* 靠加载顺序即可，禁止引入反而会导致样式缺失。
"""
import io
import os
import sys

DOCS = r"C:\Users\yan\WorkBuddy\2026-05-21-13-28-45\inspection-system\docs\rewrite-vue"
PROJ = r"C:\Users\yan\WorkBuddy\2026-05-21-13-28-45\inspection-system\vue-frontend\src\styles"

TOKENS_OLD = """   1) 项目 **禁止** import 'element-plus/dist/index.css'（会把变量锁死为编译值）
   2) main.ts 顺序：element-plus 组件样式 → component-size 样式 → 本文件"""

TOKENS_NEW = """   1) **必须** import 'element-plus/dist/index.css'（EP 组件基础样式），
      它是覆盖的前提：EP 在该文件中于 :root 声明 --el-* 默认值，本文件后加载即可同优先级覆盖。
      （依据：用户既有工程 tools-management/vue-frontend/src/main.ts:6 的已验证写法）
   2) main.ts 顺序：element-plus 组件样式(dist/index.css) → 本文件（后者必须最后）"""

SPEC_EDITS = [
    ("| AC-03 | 外壳 | While 任一路由激活，对应当前路由的菜单项**必须**高亮，且 13 个菜单项全部可见可达 | P0 |",
     "| AC-03 | 外壳 | While 任一路由激活，对应当前路由的菜单项**必须**高亮，且 **9 个菜单项**全部可见可达（与 React 版 `Sidebar.tsx` 的 `menuItems` 一致） | P0 |",
     "AC-03 菜单项数量"),
    ("13 个菜单项**全部渲染**",
     "**9 个菜单项全部渲染**（清单见 §7.1）",
     "一期骨架菜单项数量"),
    ("一期页面骨架：`MainLayout`",
     "### 7.1 一期菜单清单（9 项，与 React 版 `Sidebar.tsx:27-39` 一致）\n\n| 菜单标签 | 路由 | 目标组件 | 管理员限定 |\n|----------|------|----------|------------|\n| 用户管理 | `/users` | 占位视图 | 是 |\n| 系统设置 | `/settings` | 占位视图 | 否 |\n| 资料检索 | `/asset/search` | **SearchView（一期实现）** | 否 |\n| 数据表管理 | `/asset/ledger` | 占位视图 | 否 |\n| 设备台账 | `/asset/devices` | **DeviceLedgerView（一期实现）** | 否 |\n| 资产可视化 | `/asset-viz` | 占位视图 | 否 |\n| 二维码标签 | `/asset/qr-labels` | 占位视图 | 否 |\n| 扫码盘点 | `/asset/inventory` | 占位视图 | 否 |\n| 资料配置 | `/asset/settings` | 占位视图 | 是 |\n\n> 说明：`/cad` 的菜单项沿用 React 版现状**保持隐藏**（`Sidebar.tsx:28` 注释），但路由与页面在二期/三期等价迁移，不删代码。`/dashboard` 与 `/qr/:code` 不是菜单项（前者为默认落地页、后者为扫码深链页）。管理员限定沿用现状：生产 `DISABLE_AUTH=true` 下用户为 admin，9 项全部可见。\n\n一期页面骨架：`MainLayout`",
     "插入 7.1 菜单清单"),
]

ARCH_EDITS = [
    ("- **导入纪律（沿用 token 文件头部约定）**：项目**禁止** `import 'element-plus/dist/index.css'`；`main.ts` 顺序 = EP 组件样式 → EP component-size 样式 → token 文件**最后加载**（否则主题覆盖失效）。",
     "- **导入纪律（已按实测纠偏）**：项目**必须** `import 'element-plus/dist/index.css'`（EP 基础样式），token 文件在其**之后**加载以覆盖 `--el-*`。依据：用户既有工程 `tools-management/vue-frontend/src/main.ts:6` 的已验证写法（生产运行中）；原「禁止引入 dist css」的规定与事实不符，作废。",
     "ARCHITECTURE 导入纪律纠偏"),
]


def patch(path, edits, report):
    with io.open(path, "r", encoding="utf-8") as f:
        text = f.read()
    ok = True
    for old, new, desc in edits:
        n = text.count(old)
        report.append("%-46s count=%d" % (desc, n))
        if n != 1:
            ok = False
            continue
        text = text.replace(old, new, 1)
    if not ok:
        report.append("!! ABORT %s (assertion failed)" % os.path.basename(path))
        return False
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return True


def main():
    report = []
    allok = True

    allok &= patch(os.path.join(DOCS, "SPEC.md"), SPEC_EDITS, report)

    arch = os.path.join(DOCS, "ARCHITECTURE.md")
    allok &= patch(arch, ARCH_EDITS, report)

    for p in (os.path.join(DOCS, "design-tokens.css"),
              os.path.join(PROJ, "tokens.css")):
        allok &= patch(p, [(TOKENS_OLD, TOKENS_NEW, "导入纪律: " + os.path.basename(p))], report)

    # 写后复检
    for p, keys in (
        (os.path.join(DOCS, "SPEC.md"), ["9 个菜单项", "7.1 一期菜单清单"]),
        (arch, ["已按实测纠偏"]),
        (os.path.join(DOCS, "design-tokens.css"), ["必须** import 'element-plus/dist/index.css'"]),
        (os.path.join(PROJ, "tokens.css"), ["必须** import 'element-plus/dist/index.css'"]),
    ):
        with io.open(p, "r", encoding="utf-8") as f:
            t = f.read()
        for k in keys:
            report.append("recheck %-28s %-34s -> %d" % (os.path.basename(p), k, t.count(k)))

    report.append("ALL_OK=%s" % allok)
    with io.open(os.path.join(DOCS, "_patch2_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    if not allok:
        sys.exit(1)


if __name__ == "__main__":
    main()
