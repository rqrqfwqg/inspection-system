# inspection-system 前端整站重写 · 架构规范（Vue 3.5 + Element Plus 2.9）

> 范围：仅重写前端（`inspection-system/` 的 `src/` 与构建配置）。**后端 FastAPI 一行不动**（用户红线）。
> 目标：技术栈与用户既有项目 `tools-management/vue-frontend` 统一；**根治低有效视口下的"元素被拉伸压扁"**；产物切换可秒级回滚。
> 本规范是 Phase 1 契约，Phase 2 实现必须逐条对齐；未覆盖项进 `OPEN-DECISIONS.md`。

## 1. 背景与真实约束（证据锚点）

| 项 | 事实 | 证据 |
|----|------|------|
| 现有前端 | React 19 + Vite 6 + TS 5.7 + Tailwind **v3.4.17** + shadcn/Radix，~85 文件 | `package.json:32,51,53` |
| 后端（不动） | FastAPI:9527，前缀 `/ops/api`；SPA 从 `<项目>/dist` 托管于 `/ops`，assets 于 `/ops/assets`，上传于 `/ops/uploads` | `backend/main.py:97-100,391-408` |
| 反向代理 | 同机 nginx `location /ops/`（+`/ops/uploads/`）→ `127.0.0.1:9527`；与"物料系统"共用 443 | `deploy/nginx-inspection.conf:40-54` |
| 常量真源 | `APP_BASE='/ops'`、`API_BASE='/ops/api'`、`UPLOAD_BASE='/ops/uploads'` | `src/config.ts` |
| 路由 | 13 条路由 + `asset-viz` 内 9 个 Tabs | `src/App.tsx` |
| 用户另一 Vue 工程 | Vue 3.5 + Element Plus 2.9 + vue-router 4.5 + Pinia 2.2 + Vite 5.4 + vue-tsc | `tools-management/vue-frontend/package.json` |

### 压扁根因（必须根治）
- **反例**（压扁）：`src/features/assets/RelationGraph.tsx:134-140` —— `<svg width={VIEW_W} height={VIEW_H} style={{maxWidth:'100%'}}>`：宽高都是像素属性、只约束宽 → 容器变窄时宽被压、高不变 → 宽高比失真 → 拉伸压扁。
- **正例**（正确）：`src/components/asset/DeviceRelationGraph.tsx:42` —— `<svg viewBox={...} className="w-full h-auto">`，靠 `viewBox` 比例自适应。
- 项目内**两种写法混用且无规范** → 本次立硬规则（§4.1）。
- 附带问题：`src/index.css:6` 的 `@custom-variant xs (...)` 是 **Tailwind v4 语法写在 v3 项目**=死指令（`package.json:51` 为 v3）；`DeviceLedgerPage.tsx:756` 的 `min-w-[1100px]` 硬编码撑宽整表。

## 2. 技术选型对比矩阵（3 方案）

| 维度 | 方案 A：全新 Vue3 独立产物（推荐） | 方案 B：Vue3 新页面 + 保留 React 路由灰度 | 方案 C：不换栈，React 内修适配（基线） |
|------|--------|--------|--------|
| 形态 | 独立 Vue3 SPA，构建到 `dist/`，与 React 产物并存、切换 | Vue micro-app 挂进 React 壳（路由/路径灰度分流） | 保留 React 19 全套 |
| 真实版本 | vue 3.5.42 / element-plus 2.14.5 / vue-router 4.5.x / pinia 2.2.x / vite 5.4.x / vue-tsc 2.2.x | 同 A + React 19.0 / react-router-dom 6.28 / qiankun 2.x 或 micro-app 1.x | react 19.0 / vite 6.0 / tailwind 3.4.17（现状） |
| 迁移成本 | 中：85 文件按域重写；后端/接口契约复用 | **高**：双运行时 + 双构建 + token/鉴权桥接 + 路由互操作 | 低：只改布局与 SVG，不改栈 |
| 回归风险 | 中低：单产物，一次切换；接口契约不变（见 §8 验证） | **高**：两套生命周期/样式隔离/事件总线/包体翻倍 | 低但不解决诉求 |
| 回滚能力 | **秒级**：切换 `dist` 符号链接（§7） | 中：需回退路由分流开关，React 壳仍在 | 无需回滚（本就没换） |
| 是否满足"统一技术栈" | 满足：与 `vue-frontend` 完全一致 | 部分满足（两栈并存） | 不满足 |

**评分（10 分制，权重：统一栈/低风险/回滚/成本）**

| 方案 | 统一栈(0.3) | 低风险(0.3) | 回滚(0.2) | 成本(0.2) | 加权 |
|------|----|----|----|----|----|
| A | 10 | 8 | 10 | 7 | **8.7** |
| B | 5 | 3 | 6 | 3 | 4.1 |
| C | 1 | 9 | 9 | 9 | 6.0 |

**结论：选 A。** B 引入 qiankun/micro-app 双运行时，在"不换后端、只有 13 路由"的体量下复杂度远超收益；C 不满足用户"统一技术栈"的一级诉求。详见 `ADR-001-前端技术栈重写.md`。

## 3. 锁定技术栈（真实版本，与 vue-frontend 对齐）

```jsonc
// package.json（dependencies / devDependencies）
"dependencies": {
  "vue": "^3.5.0",                 // npm 现解析 3.5.42
  "vue-router": "^4.5.0",          // 4.5.x（刻意不上 5.3.1）
  "pinia": "^2.2.0",               // 2.2.x（刻意不上 4.0.3）
  "element-plus": "^2.9.0",        // npm 现解析 2.14.5
  "@element-plus/icons-vue": "^2.3.0", // 现解析 2.3.2 —— 全项目唯一图标库（§5）
  "echarts": "^6.1.0",             // 现解析 6.1.0（替换 recharts）
  "vue-echarts": "^8.3.0",         // 现解析 8.3.0（peer echarts ^6.0.0、vue ^3.3.0）
  "axios": "^1.7.0",
  "html5-qrcode": "^2.3.8",        // 扫码：框架无关，可原样复用
  "xlsx": "^0.18.5"                // 导出：框架无关，可原样复用
},
"devDependencies": {
  "vite": "^5.4.0",
  "@vitejs/plugin-vue": "^5.2.0",
  "typescript": "^5.9.3",
  "vue-tsc": "^2.2.12"
}
```
构建脚本：`"build": "vue-tsc && vite build"`（类型检查为必过门，拦截幻觉依赖/静默缺失）。
**不采用** npm latest 的 vue-router 5.3.1 / pinia 4.0.3 / vite 8.3.0：与既有工程不一致、破坏"统一栈"，且为未经团队验证的大版本（决策见 ADR 后果栏、OPEN-DECISIONS OD-01）。
**图表**：React 的 `recharts 2.15`（React-only）不迁移，改用 **`echarts ^6.1.0` + `vue-echarts ^8.3.0`**（现解析 6.1.0 / 8.3.0；正式选型 ADR-002 见 OPEN-DECISIONS OD-02）；现手写 SVG 关系图直接改写为 Vue 模板组件。

## 4. 响应式适配架构规范（P0 硬规则，出现即不合格）

**基准视口 = 1280×720（CSS 视口），不是 1920×1080。** 1920×1080 在 125%/150% 系统缩放下 CSS 视口仅 1536×864 / 1280×720。全站必须在此下限可用（无横向溢出、无压扁）。

### 4.1 SVG / 图表（禁止同时写死 width/height 像素属性）
- **禁止** `<svg width={px} height={px}>` 只配 `max-width:100%`（即 `RelationGraph.tsx:134-140` 反例）。
- **统一写法**（择一）：
  - 比例自适应：`<svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" class="w-full h-auto">`（`DeviceRelationGraph.tsx:42` 正例）。
  - 定高场景：外层容器 `aspect-ratio: W / H`（或 `height:固定px` + `overflow:auto` 横滚），内层 `<svg preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%">`。
- **禁止**在保证比例时使用 `preserveAspectRatio="none"`（会主动拉伸）；确需非等比填充须在本文件登记取舍理由。
- 封装 `src/components/charts/ResponsiveSvg.vue` 收敛该模式，**禁止各处手写 SVG 尺寸**。

### 4.2 Flex / Grid 子项必须 `min-width: 0`
- 凡 flex 行内承载表格/长文本/图表的子项，一律 `min-width:0`（否则内容撑破容器、被迫横滚整页）。`MainLayout` 的 `flex-1 ... min-w-0` 与 `main` 的 `min-h-0` 是既有正例，改写时保留。
- Element Plus：`el-main`/滚动容器必须 `overflow:auto` 且父链 `min-height:0`。

### 4.3 表格（`el-table`）
- 列宽**只用 `min-width`（如 `min-width="120"`）**，`el-table` 自动分配；**禁止整表写死像素宽**，禁止 `min-w-[1100px]` 式硬编码（`DeviceLedgerPage.tsx:756` 反例）。
- 宽表用**局部横滚容器**包裹（`overflow-x:auto`），不撑宽页面；操作列用 `fixed="right"`。

### 4.4 断点按 CSS 视口（不按物理分辨率）
- 目标断点集合（媒体/容器查询）：`xs<768` · `sm 768–1023` · `md 1024–1279` · **`lg 1280–1535`（主目标下限）** · `xl 1536–1919` · `2xl ≥1920`。
- **禁止**用 `window.screen.width`/`devicePixelRatio` 判定布局；用 CSS 媒体/容器查询。
- 验收视口：DevTools 固定 **1280×720** 与 **1536×864** 两档为主验。

### 4.5 rem/px 策略与 Element Plus 尺寸变量
- Element Plus 2.x 尺寸基于 px 变量（`--el-font-size-base`、`--el-component-size` 等），**不随根字号缩放**。
- **禁止全局改 `html{font-size:...}` 做整体缩放**（会导致 EP 组件与自定义 px 不一致、错位）。
- 组件/间距统一用 px + EP 变量；需要整体缩放时用 EP `size`（`default|small|large`）+ 主题变量覆盖。
- 正文排版可用 rem，但不得与 EP 组件尺寸混用同一套缩放。

### 4.6 滚动与溢出纪律
- 全站仅一个页面级滚动条：外壳 `height:100vh` 固定，内容区滚动（对齐 `MainLayout` 语义）。
- 宽内容一律用**局部横滚容器**（§4.3），禁止靠硬编码最小宽度把整页撑宽。

## 5. 图标库锁定（P0）
- **全项目唯一图标库：`@element-plus/icons-vue@2.3.2`**（与 Element Plus 同源；已与 `docs/rewrite-vue/UIUX.md` §4 与 `design-tokens.json` 的 `icon.library` **三方一致**）。
- **尺寸体系**：只用 `el-icon` 的 3 档 `size`（16 / 20 / 24），一致性靠 size + `currentColor`。EP 图标为 1024 网格填充描边风格、**无 `stroke-width` 可调**。
- **全局注册**：`src/main.ts` 遍历 `@element-plus/icons-vue` 注册（沿用 `vue-frontend/src/main.ts:31-33` 模式），模板内 `<el-icon><Menu/></el-icon>`。
- **子系统图标映射（跨栈数据约束）**：DB `subsystems.icon` 字段**已存 lucide 名**（后端/数据红线不可改）→ 前端建常量表 `SUBSYSTEM_ICON_MAP` 把 lucide 名映射到 EP 图标，未命中回落 `Box`（映射表见 `UIUX.md` §4.2）。
- **禁止**：emoji 当功能图标、再引第二套图标库（**含 lucide 系**：`lucide-vue-next` / `@lucide/vue` 均不得混入 app 业务图标）、内联零散 SVG。
  - 例外：`element-plus` 组件内部自带图标（关闭/箭头等）是其传递依赖，非"我方混用"。
- **覆盖缺口**（EP 无对应语义，如"消防"火焰）：在 `components/common/icons/` 内**按 EP 同网格（1024 viewBox / currentColor / 同视觉重量）**自补并登记（`UIUX.md` §4.2 `IconFlame.vue`），**不引第二套库**。
  - 备查：`lucide-vue-next` 在 npm 已废弃；若未来确需改用 lucide，必须用继任包 `@lucide/vue`（当前**不采用**）。

## 6. 颜色 Token 与禁用项（P0）
- 颜色唯一来源：**设计师产出的 `docs/rewrite-vue/design-tokens.css`**（含 `--el-*` 映射），落地为 `src/styles/design-tokens.css`；组件内**禁止硬编码色值**（唯一例外 `#fff` `#000`）。
- **导入纪律（已按实测纠偏）**：项目**必须** `import 'element-plus/dist/index.css'`（EP 基础样式），token 文件在其**之后**加载以覆盖 `--el-*`。依据：用户既有工程 `tools-management/vue-frontend/src/main.ts:6` 的已验证写法（生产运行中）；原「禁止引入 dist css」的规定与事实不符，作废。
- 现存违规需在改写时清除：`RelationGraph.tsx:146-157` 内联 hex（`#fca5a5/#0e7490/#b91c1c/#f9fafb/#e5e7eb` 等）→ 改走 Token。
- **禁止紫色→粉色渐变主视觉**。存量违规：`src/components/layout/Header.tsx:45` 头像占位 `from-blue-500 to-purple-500` → 改写为 Token 纯色/浅底。
- 文案必须真实（禁止空洞占位）。

## 7. 目录分层与代码组织规范（对齐 01-standards/code-organization.md）

```
src/
├── main.ts                 # 入口：只装配（createApp+pinia+router+ElementPlus+icons+mount），无业务
├── App.vue                 # 根组件：只放 <router-view/>
├── config.ts               # 常量真源（APP_BASE/API_BASE/UPLOAD_BASE）
├── router/
│   ├── index.ts            # 只装配：createRouter(history, APP_BASE) + 守卫 + 聚合
│   └── routes/{dashboard,system,asset}.ts   # 按域拆分的路由表
├── layouts/MainLayout.vue  # 外壳（el-container），只做布局
├── views/                  # 页面级：只编排，不写请求细节
│   ├── DashboardView.vue  CadView.vue  UsersView.vue  SettingsView.vue
│   ├── qr/ScanDeviceView.vue
│   └── asset/
│       ├── AssetSearchView.vue  AssetLedgerView.vue  DeviceLedgerView.vue
│       ├── AssetSettingsView.vue QrLabelView.vue InventoryView.vue
│       ├── AssetVizView.vue                     # 含 9 Tabs 容器
│       └── viz/{OverviewTab,AreaTreeTab,SubsystemTreeTab,DeviceHierarchyTab,
│                DevicePropsTab,BaSystemTab,LinkCenterTab,SearchTab,ImportTab}.vue
├── components/             # 可复用展示组件
│   ├── charts/ResponsiveSvg.vue   # §4.1 统一 SVG 容器
│   ├── asset/DeviceRelationGraph.vue  # 关系图（viewBox 自适应）
│   └── common/{AppHeader,AppSidebar,...}.vue
├── composables/            # 复用逻辑（useAuth/useToast/useTableScroll）
├── stores/                 # Pinia（auth.ts / ui.ts）
├── api/                    # 数据访问层
│   ├── http.ts             # axios 实例 + 拦截器（Bearer + 422 detail 数组拼消息，契约见下）
│   └── {auth,users,rooms,cad,asset,assetViz}.ts   # 按域模块
├── types/                  # TS 类型
├── utils/                  # 纯函数
└── styles/{design-tokens.css,base.css,responsive.css}   # design-tokens.css=设计师产出（颜色/尺寸唯一真源）
```

**硬规则（出现即不合格）**
1. 依赖**只向下**：`views → components|composables|stores|api → utils|types`；`api → http → config`。**禁止**上一层被下一层 import（如 utils 引 views）。
2. **单文件 ≤ 300 行**（不含空行注释），超限按子功能拆文件。
3. 入口 `main.ts` **只装配**，无业务逻辑；`App.vue` 只放 `<router-view/>`。
4. **页面只编排**：请求细节在 `api/`，展示细节在 `components/`，页面不写业务分支。
5. 类型独立成文件；`utils/` 只放无副作用纯函数。
6. 按域分包：一个资源一个 api 模块，不堆成 `api.ts` 单文件。

**接口契约（不变量，须与后端一致）**
- 常量：`API_BASE='/ops/api'`、`UPLOAD_BASE='/ops/uploads'`、`APP_BASE='/ops'`。
- `api/http.ts` 拦截器必须复刻现契约：请求带 `Authorization: Bearer <token>`（token 存 localStorage `token`）；响应非 2xx 时，**422 的 `detail` 为数组**须拼接为可读消息（`loc.slice(1).join('.')+': '+msg`，`；` 连接），其余取 `detail||message||'请求失败(status)'`（对齐 `src/services/api.ts:45-57`）。

## 8. 构建与部署切换方案（必须可回滚）

**产物与目录（在服务器 `<项目>/` 下）**
```
releases/
  react-<git-sha>/     # 现网 React 产物（首次即作回滚点，从当前 dist 归档）
  vue-<git-sha>/       # 新 Vue 产物（npm run build 输出重定向到此）
dist -> releases/vue-<git-sha>   # 符号链接，后端读的就是 <项目>/dist
```
- 后端 `DIST_DIR=<项目>/dist`（`main.py:97`）；`StaticFiles` 与 `FileResponse` **按请求解析路径**，故切换符号链接可**热生效**（`/ops` 与 `/ops/assets` 无需重启）；若 index 有缓存，`sudo systemctl restart inspection` 兜底。
- **发布**：`npm run build` → 输出到 `releases/vue-<sha>` → `ln -sfn releases/vue-<sha> dist`。
- **回滚（秒级）**：`ln -sfn releases/react-<old-sha> dist`（可选 restart 兜底）。React 产物在首次发布前务必先归档。
- **nginx**：`deploy/nginx-inspection.conf` 的 `location /ops/` 与 `/ops/uploads/`（→9527）**不改**（§8 已满足）。仅当希望静态绕过后端时，可增 `location /ops/ { alias ...; try_files ... }`，但需评估与同机物料系统的隔离风险，**非必需**。
- 底线：任何一步都不触碰 `backend/`、`backend/app.db`、systemd 单元与后端接口。

## 9. 端到端验证步骤（收尾即验收）

1. `npm run build` 通过（vue-tsc 零错误，无幻觉依赖）。
2. `npm run preview`，将浏览器切 **1280×720** 与 **1536×864** 两档：逐路由（13 条）走查，断言**无横向溢出、无元素压扁**；重点截图 `asset-viz` 关系图与 `asset/devices` 宽表。
3. 关键成功流：`/ops` 概览加载 → `asset/devices` 列表/分页 → 打开设备详情（关系图随容器等比缩放）→ 导出 xlsx。
4. 关键错误流：接口 422（制造校验失败）时前端展示**拼接后的可读消息**，不裸抛。
5. 发布：`ln -sfn releases/vue-<sha> dist` 后访问 `https://82.156.62.59/ops/` 复验 2–4；随后演练 `ln -sfn releases/react-<sha> dist` 回滚一次。
6. 通过 = 上述全绿 + 无 300 行超限文件 + 图标/颜色 Token 无违规。

## 10. 明确不做（Out of Scope）
- **不改后端**：`backend/**`、接口路径、`app.db`、鉴权逻辑（含 `DISABLE_AUTH`）一律不动。
- 不改 nginx 现有 `/ops/`、`/ops/uploads/` 反代语义（除非另立 ADR）。
- 不做未在 13 路由 + 9 Tabs 内的新功能（不镀金、不加未要求页面）。
- 不做 SSR/SSG；沿用纯 SPA + 后端 SPA fallback。
- 不做移动端独立 App / 小程序适配；**窄屏（<1280px）一律不做适配**（决策 D3：仅保证 ≥1280×720 桌面视口；现场扫码由既有微信小程序承担）。此前"基本窄窗可用"的表述作废。
- **功能边界零变更**（决策 D1：全量等价迁移）：不得以"合并/降级/砍掉"为名减少任何一条现有路由或子视图。§4.4 断点表中 `xs/sm/md` 三档仅用于**保证不崩坏**，不作为设计目标。
