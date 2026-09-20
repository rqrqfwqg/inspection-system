# -*- coding: utf-8 -*-
"""写入项目记忆：当日日志（追加）+ 工作区长期 MEMORY.md（追加一节）。"""
import io
import os
import datetime

MEM = r"C:\Users\yan\WorkBuddy\2026-05-21-13-28-45\.workbuddy\memory"
LOG = os.path.join(MEM, "2026-09-17.md")
LONG = os.path.join(MEM, "MEMORY.md")

LOG_ENTRY = """

## 前端整站重写为 Vue3 + Element Plus（一期已交付并实测通过）

用户诉求：1920×1080 显示器在系统缩放 125%/150% 下（CSS 视口仅 **1536×864 / 1280×720**）页面元素
**被拉伸压扁**，要求用 Element Vue UI 重构整站。经确认三条决策：**D1 全量等价迁移**（13 路由 + 9 子视图
一个不少）、**D2 先只做一期**（壳 + 设备台账 + 检索）、**D3 完全不管窄屏**（只保证 ≥1280×720）。

### 压扁根因（已定位并实测消除）
- 反例：`src/features/assets/RelationGraph.tsx:134-140` —— `<svg width={W} height={H} … style={{maxWidth:'100%'}}>`：
  **宽高都是像素属性、只约束宽度** → 容器变窄时宽被压缩、高不变 → 宽高比失真 → 压扁。
- 正例：`src/components/asset/DeviceRelationGraph.tsx:42` —— `viewBox + w-full h-auto` 永不压扁。
- 结论：旧项目**两种写法混用且无规范**，所以只在部分页面出现压扁。规范已写入 ARCHITECTURE §4.1。

### 新工程
- 目录：`inspection-system/vue-frontend/`（与 React 版**并存**，React 版未改动一行）
- 栈（已对 npm registry 实测版本）：vue 3.5.42 / element-plus 2.14.5 / vue-router 4.5 / pinia 2.2 /
  vite 5.4.21 / vue-tsc 2.2 / axios / `@element-plus/icons-vue` 2.3.2（**唯一图标库**）
- 构建脚本 `vue-tsc && vite build`（类型检查必过门）；产物 `dist/`，`base: '/ops/'`
- 关键决策：**后端 `main.py:97` 的 `DIST_DIR=<项目>/dist` 未动**，故切换靠 `dist` 符号链接，秒级回滚

### 一期交付
壳（9 菜单项全量、侧栏折叠按 §6.2 矩阵）+ 资产总台账（`/asset/devices`）+ 资料检索（`/asset/search`），
其余 10 条路由挂占位视图（**因此一期产物不能直接替换生产 `/ops`，会打断其余功能**）。

### 适配验收（几何断言，非肉眼）
`vue-frontend/scripts/verify_ui.mjs` + playwright-core + chromium-1217，3 视口 × 3 页面 = **9/9 全绿**：
A1 无页面级横向溢出 / **A2 无 SVG 压扁** / A3 无元素越界 / A4 无 body 级滚动；侧栏实测 1280→64px、
1536/1920→240px（精确符合 UIUX §6.2 矩阵）。真实数据：8,977 条资产、¥8.85 亿、180 页。
证据归档 `inspection-system/docs/rewrite-vue/{verify_report.json,shots/}`。

### 开工前后发现并纠正的事实错误（重要，别再犯）
1. **菜单项是 9 个不是 13 个**：13 是路由数；React 版 `Sidebar.tsx` 的 `menuItems` 只有 9 项
   （`/cad` 注释隐藏；`/dashboard`、`/qr/:code` 不在菜单里）。
2. **「禁止 import element-plus/dist/index.css」这条规则是错的**：用户既有工程
   `tools-management/vue-frontend/src/main.ts:6` 正是直接 import 且生产在跑；覆盖靠**加载顺序**
   （EP 基础样式 → tokens 最后）。已改正 design-tokens.css 与 ARCHITECTURE §6。
3. **lookahead 正则在 Grep 里会静默不匹配**（`#(?!fff|000)…` 返回 0 命中，把真实违规全漏掉）→
   检测硬编码色值要用 `#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\\b`；注意 Vue 插槽简写 `#default` 会误命中
   `#defa`，需用 3 位+词边界或 6 位模式区分。
4. **`Edit` 同文件并发编辑会互相覆盖**（实测 7 个编辑只落盘 1 个）→ 同文件改动改走单次原子
   python 脚本（断言命中数 + 写后复检），脚本见 `inspection-system/scripts/patch_*.py`。
5. **`npm run build` 的失败不会体现在 PowerShell 退出码上**（外层 exit 0，必须读日志里的
   `build_exit=`）。本次首轮构建因 `AppHeader.vue` 的 `noUnusedLocals` 失败，靠读日志才发现。
6. **构建会被父目录 Tailwind 配置污染**（日志出现 Tailwind 警告）→ 已加 `vue-frontend/postcss.config.js`
   显式声明空插件，切断隐式继承。
"""

LONG_SECTION = """

## Vue3 + Element Plus 重写（2026-09-17 起，与 React 版并存）
- 位置 `inspection-system/vue-frontend/`；栈 vue3.5 + element-plus 2.14 + vue-router4 + pinia2 + vite5，
  图标库唯一 `@element-plus/icons-vue`。**后端与 `main.py` 一行未动**。
- 规范真源：`inspection-system/docs/rewrite-vue/`（PRD / ARCHITECTURE / UIUX / **SPEC（唯一开发依据）** /
  design-tokens.css / OPEN-DECISIONS / **SPEC §14 偏差登记**）。
- **防压扁铁律**：SVG 禁同时写死 width/height 像素属性；只留 `viewBox` + `w-full h-auto`（或 `aspect-ratio`）；
  禁 `preserveAspectRatio="none"`；flex 承载表格/长文必须 `min-width:0`；`el-table` 列只用 `min-width`
  + 局部横滚，禁整表像素宽；禁 `transform:scale` 与改 `html font-size` 做适配。
- **断点按 CSS 视口**（非物理分辨率）：lg 1280–1535 / xl 1536–1919 为**必须完美支持**两档；
  高度轴 compact ≤760（页头 48 / 工具条 32 / 行高 32）。侧栏：≥1536 → 240px，≤1535 → 64px 图标条。
- **部署红线**：一期只实现 3 条路由，**不得用一期产物替换生产 `/ops`**，否则其余 10 条路由变占位。
  切换方案 = `releases/` + `dist` 符号链接（`main.py:97` 按请求解析，热生效、秒级回滚）。
- **验收靠几何断言不靠肉眼**：`vue-frontend/scripts/verify_ui.mjs`（playwright-core + chromium-1217），
  3 视口 × 3 页面，判 A1 无页面溢出 / A2 无 SVG 压扁 / A3 无越界 / A4 无 body 滚动。
- **合规扫描口径**：emoji 与硬编码色值扫描**不要用 lookahead 正则**（Grep 静默不匹配）；硬编码色值用
  `#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\\b` 并排除 Vue 的 `#default` 插槽简写。
"""


def append(path, text):
    exists = os.path.exists(path)
    mode = "a" if exists else "w"
    with io.open(path, mode, encoding="utf-8", newline="") as f:
        f.write(text)
    return exists


def main():
    append(LOG, LOG_ENTRY)
    append(LONG, LONG_SECTION)
    lines = []
    for p in (LOG, LONG):
        with io.open(p, "r", encoding="utf-8") as f:
            t = f.read()
        lines.append("%s lines=%d" % (os.path.basename(p), len(t.splitlines())))
    lines.append("log_has_marker=%d" % (1 if "Element Plus" in io.open(LOG, encoding="utf-8").read() else 0))
    with io.open(os.path.join(MEM, "_write_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
