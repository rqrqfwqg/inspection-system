# inspection-system 前端重写 · UI/UX 设计规范（UIUX.md）

> 设计：颜好看（UI/UX）｜日期：2026-09-17｜适用：Vue 3.5 + Element Plus 2.9 整站前端重写
> 三轴刻度：DESIGN_VARIANCE = 3（工业后台求可预测）｜MOTION_INTENSITY = 3（功能性动效）｜VISUAL_DENSITY = 8（驾驶舱）
> 配套：`design-tokens.css`（含 Element Plus 变量映射，落地为 `src/styles/tokens.css`）｜`design-tokens.json`
> 对齐上游：`ARCHITECTURE.md`（栈/图标库/断点/Token 真源/目录分层）｜`PRD.md`（P0 验收标准）｜`ADR-001`
> 本次第一优先级：**小视口不压扁**（1920×1080 @125% → 1536×864；@150% → 1280×720）

---

## 1. 视觉主题与对标品牌

**视觉主题关键词**：精确 · 克制 · 高密度 · 可信 · 无装饰

**氛围描述**：浅色工业控制台式工作台。白卡片 + 极细分隔线承载信息，蓝色只用于"当前所在位置"与"主行动"，7 个子系统色只作分类辅助。像配电柜铭牌——不解释自己，只保证每个数字都在该在的位置。

**对标品牌（各有明确取用点）**

| 对标 | 取用什么 | 不取用什么 |
|------|----------|-----------|
| **Linear** | 密度与节奏（32-36px 行高、13px 表格字、颜色只用于状态） | 深色默认、动效编排 |
| **Ant Design Pro / 阿里云 Xconsole** | 三段式框架（全局导航固定、只中间弹性）、栅格、最小宽度兜底 | EP 默认 `#409EFF` 的"无品牌感" |
| **IBM Maximo Manage** | 资产台账→层级树→详情面板的信息架构；图谱工具条 expand/zoom-to-fit | 陈旧的信息层级、成排堆叠的按钮 |

**明确不做**：不做营销落地页式 Hero；不做"大数字 KPI + 渐变"的 SaaS 套路；不做毛玻璃；不做动效表演。使用者每天在这屏待 8 小时，唯一的"惊艳"应该是"信息刚好在手上"。

---

## 2. 色彩系统

### 2.1 四层 Token（完整值见 `design-tokens.css` / `.json`）

| 层 | Token | 值 | 说明 |
|---|---|---|---|
| A1 | `--bg` | `#F5F7FA` | 页面底（对齐 EP `--el-bg-color-page`，把覆盖面积压到最小） |
| A1 | `--surface` | `#FFFFFF` | 卡片 / 面板 |
| A1 | `--fg` / `--fg-2` / `--muted` / `--meta` | `#303133` / `#606266` / `#909399` / `#A8ABB2` | 四级前景，均非纯黑纯灰 |
| A1 | `--border` / `--border-soft` | `#DCDFE6` / `#EBEEF5` | 边框 / 行内分隔 |
| A1 | `--accent` | `#2563EB` | 品牌主色。**沿用现网 blue-600**，与 tools-management 同族、不同像素 |
| A2 | `--success` `--warn` `--danger` `--info` | `#16A34A` `#D97706` `#DC2626` `#0EA5E9` | 填充/图标用；文字用 `-fg` 变体（4.6 / 4.9 / 5.9 / 5.5 : 1，全过 AA） |
| B-slot | `--accent-hover` `--accent-active` `--accent-soft` | `#6692F1` `#1E4FBC` `#E9EFFD` | 直接等于 EP light-3 / dark-2 / light-9，单一事实源 |
| C-ext | `--sys-*` × 7 | 见 §2.4 | 子系统分类色 |

> 配色来源：`design-systems/color-palettes.md` 第 1 套「SaaS 通用信任蓝」（Primary `#2563EB`）。两处主动偏离：中性色改为对齐 Element Plus 默认值以压缩覆盖面；**不采用该套的橙色 Accent**——橙色在本系统语义上归属 `--warn`（待处理/告警），不能兼职 CTA。

### 2.2 用色纪律

1. **每屏可见 `--accent` 不超过 2 处**（侧边栏当前项算 1 处，页面主 CTA 算 1 处），其余一律中性色。
2. 页面标题、表头、KPI 数字一律用 `--fg`，**不用主色**。主色铺得越多，越找不到"下一步点哪"。
3. 语义色只表达状态，不表达层级；禁止用语义色大面积铺底（除 Tag / Banner 的 `-bg` 浅底）。
4. 组件内**禁止字面 hex**（唯一例外 `#fff` / `#000`），一律 `var()`。

### 2.3 Element Plus 映射（摘要；完整 90+ 项见 CSS）

| 我们的 Token | Element Plus 变量 | 值 |
|---|---|---|
| `--accent` | `--el-color-primary` | `#2563EB` |
| `--accent-hover` | `--el-color-primary-light-3` | `#6692F1` |
| `--accent-active` | `--el-color-primary-dark-2` | `#1E4FBC` |
| `--accent-soft` | `--el-color-primary-light-9` | `#E9EFFD` |
| `--text-base` / `--text-sm` | `--el-font-size-base` / `-small` | `14px` / `13px` |
| `--radius-md` / `--radius-sm` | `--el-border-radius-base` / `-small` | `6px` / `4px` |
| `--row-h`（默认档） | `--el-component-size` | `32px` |
| `--sider-w-collapsed` | `--el-menu-collapse-width` | `64px` |
| `--motion-base` | `--el-transition-duration` | `160ms` |
| `--bg` / `--fg` / `--muted` | `--el-bg-color-page` / `--el-text-color-primary` / `--el-text-color-secondary` | 见 CSS |

### 2.4 子系统分类色（C-extension）

`电力 #2563EB`｜`消防 #DC2626`｜`弱电 #0D9488`｜`制冷 #0891B2`｜`照明 #CA8A04`｜`给排水 #0369A1`｜`暖通 #EA580C`

**硬约束**：颜色只是辅助。图谱节点 / 图例 / 徽标**必须同时携带 2 字简称**（电/消/弱/冷/照/水/暖），禁止以颜色作为唯一区分（WCAG 1.4.1）。上色刻意规避紫色系，避免与 Indigo/Purple 的 AI 模板语言混淆。

### 2.5 深色主题

沿用现网约定：`[data-theme="dark"]` **仅 class 触发、不跟随系统**，MVP **不启用**，Token 已在 CSS 备好（P2）。深色下用亮度递进表达层级（`#0F1115 → #171A21 → #1D2129 → #232833`），不靠阴影。

### 2.6 已知坑位（Element Plus 主题）

| # | 坑 | 后果 | 处置 |
|---|---|---|---|
| P1 | 项目里 `import 'element-plus/dist/index.css'` | 变量被编译值锁死，CSS 变量覆盖全部失效 | 删除；改按需引入 + `tokens.css` 最后加载 |
| P2 | 只覆盖 `--el-color-primary` | hover / plain / disabled 仍是 EP 默认蓝 | light-3/5/7/8/9 与 dark-2 全部显式给值 |
| P3 | 用 `el-col` 响应式 props 做断点 | EP 的 `md=992 / lg=1200 / xl=1920` 与本规范 §6 断点**不一致**（1280、1536 会错档） | 禁用 `el-col` 响应式 props；统一 `useBreakpoint()` + 媒体查询 |
| P4 | 现网 `src/index.css:6` 的 `@custom-variant xs` | **Tailwind v4 语法写在 v3 项目**（同文件用 `@tailwind base`），是死指令，不生效且误导后人 | 重写时删除；断点只保留 §6 一套定义源 |

---

## 3. 字体与排版

**字体栈（明确品牌组合，非"默认系统字体直出"）**

```css
--font-display/body: "Inter", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
--font-mono:         "Spline Sans Mono", "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
```

选择依据：产品型寄存器，只上无衬线（Dashboard 上禁止衬线体）。三个品牌声音词：**精确、机械、耐读**（物理参照物：1980 年代工业控制面板的铭牌）。

- **拉丁与数字用 Inter**：需要 tabular numerals 对齐台账数字（电容量 KW、序号、线径、距离）。
- **中文用系统字体**（PingFang / Microsoft YaHei）：机场内网可能访问不到 Google Fonts，且 Noto Sans SC 全量约 5-10MB，首屏代价不可接受。中文字体不做 webfont。
- **等宽用 Spline Sans Mono**：设备编号含 `L-3F-A-001`、`G-P(Y)-RF-01-04`、`C-B1-S-1DEMO-1_1#`，`1/l/I` 与 `0/O` 必须可辨。
- **内网自托管**：`npm i @fontsource/inter @fontsource/spline-sans-mono`；**禁止 CDN**（代码里不得出现 `fonts.googleapis.com`）。

**字号阶梯（8 级，`--text-xs` 12px 为全站下限，禁止低于 12px）**

| Token | px | 行高 | 用途 |
|---|---|---|---|
| `--text-xs` | 12 | 1.5 | 元数据、Tag、辅助说明 |
| `--text-sm` | 13 | 1.35 | 表格单元、表单 label、侧边栏菜单 |
| `--text-base` | 14 | 1.5 | 正文基准 |
| `--text-lg` | 16 | 1.35 | 卡片标题 |
| `--text-xl` | 18 | 1.3 | 区块标题 |
| `--text-2xl` | 20 | 1.25 | 页面标题 |
| `--text-3xl` | 24 | 1.2 | 指标数字（等宽数字） |
| `--text-4xl` | 30 | 1.2 | 仅 Dashboard 首要指标，一屏不超过 1 处 |

**字重三级**：400 读（正文/表格内容）｜510 强调（表头/小标题/按钮）｜590 宣告（页面标题/关键数字）。
**字距**：标题 `-0.01em`｜正文 `0`｜全大写 `不低于 0.06em`（设备编号类大写串必须加，否则挤成一团）。
**数字纪律**：所有台账数值、序号、统计数字必须 `font-variant-numeric: tabular-nums` + 右对齐，否则列扫读会跳动。

---

## 4. 图标系统（对齐 `ARCHITECTURE.md` §5，锁定 `@element-plus/icons-vue`）

**唯一图标库：`@element-plus/icons-vue@2.3.2`**（架构师已锁定，全项目不得混用第二套、不得内联零散 SVG）。

### 4.1 尺寸规范（只有 3 档）

| 尺寸 | 场景 | 写法 |
|---|---|---|
| 16px | 行内（表格单元、Tag、面包屑、下拉项） | `<el-icon :size="16">` |
| 20px | 按钮内 | `<el-icon :size="20">` |
| 24px | 独立图标、侧边栏菜单、空状态 | `<el-icon :size="24">` |

EP 图标为 1024 网格填充描边风格，**没有 `stroke-width` 可调**——一致性靠统一 `size` 与 `color: currentColor` 保证，**不要**再引入第二套"描边型"图标库（会立刻显出色重差）。混排图标必须 `flex: 0 0 auto`，否则会被 flex 压成椭圆。

### 4.2 子系统图标映射（`subsystems.icon` 存的是 lucide 名，禁止改后端/数据）

前端建一张常量表 `SUBSYSTEM_ICON_MAP`，把库里已有的 lucide 名映射到 EP 图标；未命中一律回落 `Box`，保证不白屏。

| 子系统 | DB 现存（lucide 名） | 映射到 EP 图标 | 备选 |
|---|---|---|---|
| 电力 power | `Zap` | `Lightning` | `Odometer` |
| 消防 fire | `Flame` | `IconFlame`（自补，见下） | `Warning` 暂替 |
| 弱电 weak | `Cable` | `Connection` | `Link` |
| 制冷 refrig | `Snowflake` | `Refrigerator` | `IceDrink` |
| 照明 lighting | `Lightbulb` | `Sunny` | `ReadingLamp` |
| 给排水 water | `Droplets` | `Pouring` | `HotWater` |
| 暖通 hvac | `Fan` | `WindPower` | `Switch` |

> 「消防」在 EP 图标集内无火焰语义图标。按 `ARCHITECTURE.md` §5 的**覆盖缺口**条款处理：在 `components/common/icons/IconFlame.vue` 内**按 EP 同一网格与视觉重量**（1024 viewBox、`currentColor`、与 `Lightning` 目视等重）自补一枚，并在该目录 `README` 登记；**不引第二套图标库**。
> Phase 2 必须用 `import * as Icons from '@element-plus/icons-vue'` 校验上表名称真实存在，缺失者走备选列。

### 4.3 禁止清单

emoji 作功能图标（火箭/火焰/灯泡/星星/闪光/图表/靶心等一律禁止）；`preserveAspectRatio="none"`；图标当按钮却不给 `aria-label`；同一屏出现两种风格的图标。

---

## 5. 间距 / 圆角 / 阴影 / 层级

- **间距**：4px 网格，只允许 `4 8 12 16 20 24 32 40 48 64`。禁止 5/7/13/15/22/30。
- **圆角**：`sm 4px`（Tag/Input）｜`md 6px`（Button/Select）｜`lg 8px`（Card/Panel/Dialog，**上限**）｜`pill`。工业后台用小圆角表达精确感；**禁止不低于 16px 的卡片圆角**（AI 过度圆滑）。
- **阴影**：卡片默认 `--elev-ring`（1px 环，**不用模糊**）；悬浮/下拉用 `--elev-raised`；Dialog/Drawer 用 `--elev-overlay`。**禁止"1px 边框 + 模糊不低于 16px 的阴影"同时出现在同一元素**（幽灵卡片）。
- **层级 z-index**：`sticky 100 / dropdown 1000 / panel 2000 / toast 3000`；禁止 9999 魔法数字。
- **节区节奏**：`--space-5`(20px) 为 `.app-content` 基准内边距，窄档降到 `--space-4` / `--space-3`。
- **容器**：后台铺满（`--container-max: none`），不做居中留白，避免 4K 浪费；仅长表单页限宽 `--form-max: 960px`。

---

## 6. 响应式适配规范（本次第一优先级 · 可执行硬规则）

### 6.1 断点集合（单位 = CSS 视口宽，已计入系统缩放；与 `ARCHITECTURE.md` §4.4 完全一致）

| 档 | 视口宽 | 真实场景 | 达标要求 |
|---|---|---|---|
| `xs` | < 768 | 现场手机 | 基本可用（非完美）——仅 `/asset/inventory`、`/qr/:code` 需跑通 |
| `sm` | 768-1023 | 平板横屏 | 基本可用 |
| `md` | 1024-1279 | 小笔记本 | 可用 |
| `lg` | **1280-1535** | **1920×1080 @150% → 1280×720** | **必须完美支持** |
| `xl` | **1536-1919** | **1920×1080 @125% → 1536×864**；1366×768@100% | **必须完美支持** |
| `2xl` | 不低于 1920 | 1920×1080 @100% | 必须完美支持 |

**另设高度轴**（720 档的痛点在高度，不在宽度）：`compact ≤760px` ｜ `normal 761-900px` ｜ `tall >900px`。
判定**只用 CSS 媒体查询**；禁止用 `window.screen.width` / `devicePixelRatio` 判布局（`ARCHITECTURE.md` §4.4）。

### 6.2 每档行为矩阵（写死，不得即兴发挥）

| 维度 | 2xl 不低于 1920 | xl 1536-1919 | lg 1280-1535 | md 1024-1279 | sm 768-1023 | xs < 768 |
|---|---|---|---|---|---|---|
| 侧边栏 | 240px 展开 | 240px 展开 | **64px 图标条**（悬停/点击临时浮层展开 240px，不挤压内容） | 64px 图标条 | 隐藏，页头汉堡抽屉 | 隐藏，页头汉堡抽屉 |
| 内容区宽 | 全宽 | 全宽（约 1272） | 全宽（约 1216） | 约 960 | 约 768 | 约 375 |
| 卡片栅格 | 4 列 | 3-4 列 | **3 列** | 2 列 | 2 列 | 1 列 |
| 表格 | 全列 | 全列 + 横向滚动兜底 | **列裁剪**：保留 4-6 关键列 + 「列设置」抽屉 | 列裁剪 4 列 + 详情抽屉 | 关键列固定 + 横向滚动 | 表转卡片流（`el-card` 列表） |
| 多列表单 | 3 列 | 3 列 | **2 列**（label 置顶） | 2 列 | 1-2 列 | 1 列 |
| 右侧详情面板 | 常驻 320-420 | 常驻 320-420 | **改抽屉** | 抽屉 | 抽屉 | 抽屉 / 全屏 |
| 三段式（左树+主+右） | 三段 | 三段 | **两段**（左 64 图标条 + 主） | 两段 | 单段 | 单段 |
| 页头高 | 56 | 56 | 56（视口高不高于 760 时 48） | 56 / 48 | 48 | 48 |
| 工具条高 | 40 | 40 | 40（视口高不高于 760 时 32） | 40 / 32 | 32 | 32 |
| 表格行高 | 40 | 36 | **36**（视口高不高于 760 时 32） | 32 | 32 | 44（触摸） |
| 次要操作 | 全显 | 全显 | 溢出进 `el-dropdown`「更多」 | 溢出 | 溢出 | 底部操作条 |

**两档完美支持的落地要点**

- **1536×864**：3 列卡片栅格 + 侧栏 64px 图标条 + 表格全列 + 右侧面板仍常驻（约 26%）。高度充足，不改密度。
- **1280×720**：3 列卡片 + 64px 图标条 + **表格列裁剪**（关键：1216px 放不下 8-12 列的台账，绝不靠缩字号硬塞）+ **高度轴 compact 生效**（页头 48 / 工具条 32 / 行高 32 / 右面板改抽屉），把约 664px 可视高用出 20 行以上。
- 表格列裁剪由列级 `min-width` 之和驱动：`visibleCols = cols.filter(c => sum(minWidth) <= containerWidth)`；溢出列进「列设置」抽屉并支持勾选（偏好存 localStorage）。**不设"整表最小宽度"**。

### 6.3 布局弹性归属（Xconsole 原则：只动内容，不动导航）

三段式骨架中**只有中间主区弹性**（`flex: 1 1 auto; min-width: 0`）；左导航树与右详情面板只做「折叠 / 隐藏」二态切换，**绝不改变其宽度与布局逻辑**。这是可预测性的基础——用户换了显示器，导航还在原地。凡 flex 行内承载表格/长文本/图表的子项，一律 `min-width: 0` + 父链 `min-height: 0`（`ARCHITECTURE.md` §4.2）。

### 6.4 防压扁硬规则（10 条，违反即退回重做）

| # | 规则 | 反例 |
|---|---|---|
| **AS-1** | 所有 `<svg>` 必须有 `viewBox="0 0 W H"`，**禁止写 `width` / `height` 属性**；容器定宽，SVG `width:100%; height:auto`，或容器 `aspect-ratio: W/H` | `RelationGraph.tsx:134-140`：`viewBox` + `width={VIEW_W}` + `height={VIEW_H}` + `style={{maxWidth:'100%'}}` → 宽压到 100% 而高不变 = **被压扁**（本次死因） |
| **AS-2** | 显式写 `preserveAspectRatio="xMidYMid meet"`；**禁止 `="none"`** | 正例：`DeviceRelationGraph.tsx:42` 的 `viewBox` + `w-full h-auto`，全项目统一为它 |
| **AS-3** | 禁止 `width={W} height={H}` 与 `max-width:100%` 共存（互斥策略，同时写必然失真） | 同 AS-1 |
| **AS-4** | **固定高度白名单**（只这些可写死 px）：页头 48/56、工具条 32/40、表格行 32/36/40、侧栏 64/240、Tag、图标 16/20/24、分页器。其余一律 `height: auto` / `min-height` | 把卡片写成 `h-screen`、`h-16` 全站写死 |
| **AS-5** | 卡片、面板、图谱容器、图表容器、表单容器**禁止写死 height** | 卡片写 `height: 320px` 会切掉长设备名 |
| **AS-6** | 图片 / 二维码 / 缩略图用 `aspect-ratio` + `object-fit`；禁止宽高 px 后再加 `max-width:100%` | 标签二维码固定 `aspect-ratio: 1` |
| **AS-7** | **禁止在容器上写死表格最小宽**；改列级 `min-width` + 局部横滚容器 | `DeviceLedgerPage.tsx:756` 的 `min-w-[1100px]` → 1280 档整页横向滚动 |
| **AS-8** | `el-dialog` / 抽屉 / 详情面板宽度用 `%` 或 `clamp()`；禁止 px | `el-dialog` 写 `width="800px"` → 1280 档溢出 |
| **AS-9** | **禁止 `transform: scale()` 做响应式适配**（字变糊 + 点击热区错位）；禁止全局改 `html{font-size}` 做整体缩放 | — |
| **AS-10** | flex 混排中的图标 / 头像 / Tag / 二维码必须 `flex: 0 0 auto` | 无 `shrink-0` 的图标会被压成椭圆 |

> 自检命令（Phase 3 交付前必跑，命中任一即未通过）：
> `rg 'preserveAspectRatio="none"|<svg[^>]*width=|maxWidth.*100%|min-w-\[\d{3,}px\]|width="\d+px"' src/`

### 6.5 文字溢出策略（三选一，禁止四不像）

| 场景 | 策略 | 实现 |
|---|---|---|
| 表格单元、面包屑、Tag、下拉项、菜单 | 单行省略 | `.ellipsis-1` + `show-overflow-tooltip` / `el-tooltip` 兜底 |
| 卡片标题、设备名称、问题描述 | 两行截断 | `.ellipsis-2`（`-webkit-line-clamp: 2`） |
| 设备编号、机房编号、含 `()`/`#` 的长码 | 强制断行 | `.code-break`（`var(--font-mono)` + `word-break: break-all`），**禁止省略**——编号少一位就查不到 |

**禁止**：`white-space: nowrap` 不配 `overflow:hidden` + `text-overflow:ellipsis`（会溢出容器，把整页撑出横向滚动条）。标签打印区（`/asset/qr-labels`）用 `mm` 物理单位，**豁免**响应式（物理尺寸映射，不允许随视口变）。

### 6.6 Element Plus 组件在小视口下的参数（逐条可落地）

| 组件 | 规则 |
|---|---|
| `el-table` 列宽 | **一律用 `min-width`（自动按比例分配），禁用 `width` 固定值**；仅「操作列」「复选框列」用 `width`。关键列（设备编号/名称）`fixed="left"`，最多 2 列；操作列 `fixed="right"` |
| `el-table` 溢出 | 文本列显式 `show-overflow-tooltip`；封装 `DataTable.vue` 中默认透传 `:show-overflow-tooltip="true"`，仅自定义 `template` 列关闭 |
| `el-table` 高度 | 用 `height="100%"` / `max-height` 配 `flex:1; min-height:0` 实现「表头固定 + 体滚动」；**禁止写死 px height**。外壳 `.data-table-wrap { overflow-x: auto }` |
| `el-table` 密度 | 行高由 `.el-table__cell` 上下 padding 控制（compact 4px / normal 6px / tall 10px），**不缩字号**；超过 100 行启用虚拟滚动；列数多的动态表强制「列设置」 |
| `el-form` | 不低于 1280：`label-position="right"` + `label-width` 固定；**低于 1280 强制 `label-position="top"`**（省横向空间）。栅格用 CSS Grid 或 `<el-row :gutter>`，**不用 `el-col` 响应式 props**（坑 P3） |
| `el-form` 分组 | 每组可见字段不超过 4 个（工作记忆限制），超额用 `el-collapse` 渐进披露 |
| `el-tabs` | 溢出不靠箭头硬挤：Tab 数超过 4 或容器低于 1280 时，改为 `el-radio-group`（`size="small"` 分段控件）常显前 3 项 + `el-dropdown`「更多分组」。`/asset-viz` 的 9 个子视图必须走这条 |
| `el-dialog` | `width` 用 `clamp(520px, 42vw, 860px)`；`top="8vh"`（低于 1280 时 5vh）；`append-to-body`；打开时锁定 body 滚动。**低于 1024 或视口高不高于 760 时改 `el-drawer`** |
| `el-drawer` | 右侧详情：`direction="rtl"`、`size="min(92vw, 480px)"`；xs 档 `size="92vw"`；抽屉内表单一律单列 |
| `el-menu` | `:collapse="isCompact"`，`--el-menu-collapse-width: 64px`；**关闭 `collapse-transition`**（宽过渡会掉帧）；折叠态每个 `el-menu-item` 必须包 `el-tooltip` 保可发现性 |
| `el-pagination` | 不低于 1536：`total, sizes, prev, pager, next, jumper`；1280-1535：去 `sizes/jumper`；低于 1280：`prev, pager, next` + `small`。始终右对齐，随表格底部固定 |
| `el-tree` | `default-expanded-keys` 只展第一层（8000+ 资产全展开会卡死）；机房树（871 房间）用 `el-tree-v2`；节点 label 单行省略 + tooltip |
| `el-descriptions` | 设备属性：`column` 随档 3 / 2 / 1；`label-width` 自适应；长值走 `.code-break` |
| `el-empty` | 文案必须具体（"未找到设备 L-3F-A-001，请检查编号或调整检索深度"），**禁止空洞占位** |
| `el-message-box` | 危险操作（删设备/删表）必须带对象名与影响面（"将软删除设备 L-3F-A-001，其 4 条历史资料保留"） |
| `el-tooltip` | `:show-after="300"` 避免扫读闪烁；内容不超过 2 行；`append-to-body` |

---

## 7. 组件规范与状态矩阵

### 7.1 组件规格

| 组件 | 规格 |
|---|---|
| Primary Button | `--accent` 底 + `--accent-on` 字，`radius-md`(6)，padding `10px 16px`，字重 510，`--motion-fast` 过渡 |
| Secondary Button | 透明底 + `1px solid var(--border)`，字 `--accent`，hover 时边框转 `--accent` |
| Ghost / Text | 无边框，hover 出 `--surface-3` 底 |
| Danger Button | `--danger` 底；仅用于不可逆操作，且必须二次确认 |
| Card / Panel | `--surface` + `1px solid var(--border-soft)` + `radius-lg`(8)，**无默认阴影**。hover 反馈用 `border-color: var(--accent)`，**不用左侧彩色粗边条** |
| Input | `--surface` 底 + `1px var(--border)`；focus：边框转 `--accent` + `--focus-ring`；error：`--danger` + 字段下方 20 字内的具体错误 |
| Table | 表头 `--bg` 底 + `--fg` 字 + 510 字重；行 hover `--accent-soft`；**不用斑马纹**（分隔线已足够） |
| Tag | `radius-sm`，`-bg` 浅底 + `-fg` 文字；**绝不只靠颜色**，必须带文字标签 |
| 关联图谱 | 容器 `--graph-bg`；节点 `radius-md` + 子系统色左边条 4px + 2 字简称 + 编号；边用箭头表方向（供电 / 上级配电 / 所在机房），线型表类型（实线=供电、虚线=控制、点线=管路）；必须提供「适应窗口 / 放大 / 缩小」工具条（Maximo 取用点）；节点 hover tooltip，点击以该节点重检索 |

### 7.2 状态矩阵（9 态，每个数据组件必须覆盖）

| 状态 | 要求 |
|---|---|
| Default | 正常态 |
| Hover | 120-160ms 过渡；表格行 `--accent-soft` |
| Focus | `:focus-visible` 可见环（`--focus-ring`）；**禁止 `outline: none` 不留替代** |
| Active | 按下态 `--accent-active` |
| Disabled | `--el-disabled-*`；禁用态**保留** tooltip 说明原因 |
| Loading | 表格 `v-loading` + 骨架屏；图谱/图表用**同尺寸骨架占位**（不用 spinner 撑高容器，防 CLS） |
| Empty | `el-empty` + 具体引导 + 一步操作按钮 |
| Error | 区分网络 / 权限 / 校验；给重试按钮；不暴露技术栈细节 |
| Success | 轻量 `el-message`（不超过 3s）或行内 `--success-fg` 标注，不弹 Modal |

---

## 8. 13 路由 × 2 档 布局骨架

> `[H]` 页头｜`[T]` 工具条｜`【x/y】` 左右分栏比例｜`抽屉` = `el-drawer` 化

| # | 路由 | 1536×864（xl 档） | 1280×720（lg 档 + 高度 compact） |
|---|---|---|---|
| 1 | `/dashboard` 运维总览 | `[H]` 面包屑 + 全局检索 ｜ KPI 条 3 列紧凑指标卡（非 Hero 大数字）→ `【2fr/1fr】` 左：趋势 + 子系统分布图（`aspect-ratio:16/9`）／右：待办 + 告警列表 | 同结构；KPI 改 2×2；**右列下移到图表下方**（上下堆叠）；图表容器 `aspect-ratio` 自适应 |
| 2 | `/cad` 图纸 | 三段：`【240 / flex / 320】` 左图层树 ｜ 中 CAD 画布 ｜ 右图元属性 | 两段：左树 64px 图标条 ｜ 画布 flex；**右属性改抽屉**（点图元从右滑出） |
| 3 | `/users` 用户 | `[T]` 筛选 3 列 + 全列表格（用户名 / 角色 / 状态 / 最近登录 / 操作） | 筛选条 2 列（可折叠）；表格裁剪为 4 列 + 「列设置」抽屉 |
| 4 | `/settings` 设置 | 两段：`【200 / flex】` 左分组锚点 ｜ 右分组卡片，表单 2 列 | 单段：顶分段控件横向切分组；表单 **1 列**，label 置顶 |
| 5 | `/asset/search` 资料搜索 | `[T]` 编号输入 + 深度选择（默认 2，1-5）+ 检索 ｜ 设备信息卡 ｜ `【1fr / 420px】` 左：子系统 Tabs + 各资料表 ／ 右：**关联图谱** | 图谱**移到资料卡上方或下方，全宽**（`aspect-ratio` 自适应，绝不压扁）；子系统 Tabs 改分段控件 + 「更多」下拉；图谱工具条常驻 |
| 6 | `/asset/ledger` 资料台账 | 两段：`【260 / flex】` 左子系统→资料表树（`el-tree-v2`）｜ 右动态记录表（列由 `field_defs` 生成，列级 `min-width`） | 左树降为 **64px 图标条**（hover 浮层展开）；右表**列裁剪**（关联键列 + 3-5 列 + 操作）+ 「列设置」抽屉；导入/导出进「更多」 |
| 7 | `/asset/ledger/:tableId` 动态表管理 | 表名 + 字段管理 ｜ `[T]` 新增 / 导入 / 导出 / 列设置 ｜ 全列动态表；行编辑 → 右侧抽屉 480 | 表头收为单行 + 「更多」；表格裁剪；行编辑抽屉 `min(92vw,480px)`；字段管理改整页 |
| 8 | `/asset/devices` 设备台账 | 两段：`【260 / flex】` 左设备层级树 ｜ 右设备表 + 关联图谱（Tab 切换） | 左树 64px 图标条；右表裁剪；关联图谱全宽；关联编辑用 `el-dialog clamp(520px,42vw,860px)` |
| 9 | `/asset/settings` 资料配置 | **三级主从**：`【200 / 240 / flex】` 子系统 ｜ 资料表 ｜ 字段表格 | 三级**上下堆叠**：子系统选择器 → 资料表分段控件 → 字段表格全宽；字段新增走抽屉 |
| 10 | `/asset/qr-labels` 标签打印 | A4 横向打印布局（`@page size: A4 landscape`），屏幕预览按 `mm` 固定（`.label-cell` 64mm）；**豁免响应式**（物理尺寸映射） | 同；仅屏幕工具条响应式（导出 / 打印 / 份数） |
| 11 | `/asset/inventory` 盘点（现场扫码） | `【1fr / 1.4fr】` 左任务列表 ｜ 右盘点明细（表格 + 扫码输入框常驻焦点） | 单列卡片流 + **底部固定操作条**（扫码 / 提交，`env(safe-area-inset-bottom)`）；行高 44 触摸档 |
| 12 | `/qr/:code` 扫码详情 | `【1fr / 1fr】` 左设备卡 + 资料分组 ｜ 右关联设备列表 | **移动优先单列**：设备卡 → `el-collapse` 资料分组 → 关联设备**列表**（小屏**不画图谱**，画图不如列表好点） |
| 13 | `/asset-viz` 资产可视化（9 子视图） | 顶层 9 Tab 常显；概览 = KPI 卡栅格 + 2 图；区域树 / 子系统树 / 设备层级 = 左树 + 右详情 `【280/flex】`；设备属性 = `el-descriptions` 3 列；联动中心 = 左列表 + 右图谱；检索 / 导入 = 表格页 | **9 Tab 溢出 → 常显前 3 + 「更多」下拉**；树类子视图左树降 64px 图标条、右详情改抽屉；属性列 2 列；图谱全宽 |

**跨路由统一约定**：页头恒为「面包屑 + 全局设备检索 + 用户」；工具条恒为 40/32px，主行动在左、次要行动溢出进「更多」；任何表格页必须有「列设置」抽屉；任何图谱页必须有「适应窗口 / 放大 / 缩小」；任何详情面板在低于 1280 一律抽屉化。

---

## 9. Agent 实现指南（交前端）

**落地顺序**（目录分层遵循 `ARCHITECTURE.md` §7）：① `src/styles/tokens.css` 按本文件 `design-tokens.css` 落地 → 顺序见其文件头注释 → ② `composables/useBreakpoint.ts`（输出 `{ tier, isCompactHeight, isDense }` 并挂 class 到 `<html>`）→ ③ `layouts/MainLayout.vue`（页头 + 侧栏 + 内容）→ ④ `components/common/DataTable.vue`（列裁剪 + `show-overflow-tooltip` 透传 + 列设置持久化）→ ⑤ `components/charts/ResponsiveSvg.vue`（**承接 `ARCHITECTURE.md` §4.1 的 SVG 唯一入口**）→ ⑥ `SplitPane`（三段式，右面板自动抽屉化）→ ⑦ 13 路由视图。

**必须收敛的三个壳**：`ResponsiveSvg`（图表/图谱）、`SplitPane`（左右/三段式与详情面板）、`DataTable`（宽表）。**任何页面自己写 SVG 尺寸或自己写表格宽度 = 违规。**

**已知坑清单（本仓历史，重写时逐条消除）**

- `RelationGraph.tsx:134-140` 压缩失真根因（AS-1 / AS-3）→ 改为 `viewBox` + `w-full h-auto`。
- `RelationGraph.tsx:146-157` 内联 hex → 改走 Token（`ARCHITECTURE.md` §6）。
- `DeviceLedgerPage.tsx:756` `min-w-[1100px]`（AS-7）。
- `src/index.css:6` Tailwind v4 `@custom-variant` 死指令（坑 P4）。
- `Header.tsx:45` 紫蓝渐变头像占位 → 改 Token 纯色/浅底。
- `subsystems.icon` 存 lucide 名 → 走 §4.2 映射表，未命中回落 `Box`，不得白屏。
- 设备编号含 `#` / `()` → URL 必须 `encodeURIComponent`，且用 `.code-break` 保证完整显示。

**交付自检（缺一不可）**

1. `rg` 扫描 §6.4 反例零命中；
2. 1536×864 与 1280×720 双档实测：13 路由无横向滚动、无元素压扁（重点截图 `asset-viz` 关系图与 `asset/devices` 宽表）；
3. emoji 正则扫描零命中（功能图标全走 `@element-plus/icons-vue`）；
4. 组件内零字面 hex（除 `#fff` / `#000`）；
5. 键盘 Tab 走通主流程，focus 环可见；
6. `prefers-reduced-motion` 下动效归零；
7. Loading / Empty / Error / Populated / Edge 五态覆盖；
8. 无单文件超 `ARCHITECTURE.md` 规定的 300 行。
