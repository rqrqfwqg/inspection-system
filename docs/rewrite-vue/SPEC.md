# Spec · inspection-system 前端整站重写 v1.0

> 生成日期：2026-09-17　生成人：韦优（项目总监）
> 依据：`PRD.md` v1.1（决策冻结） + `ARCHITECTURE.md` v1.0 + `UIUX.md` v1.0 + `design-tokens.css`
> 状态：**已确认**（一期范围锁定；二期/三期暂缓，待一期验收后重新评估）
> 效力：**本 Spec 是开发的唯一依据**。与三文档冲突时以本 Spec 为准；改动须走 §13 变更记录流程。

---

## 1. 产品定义

- **一句话**：在不改后端、不改 API 的前提下，把 T3 GTC 运维资产管理系统的 React 19 前端整站重写为 Vue 3.5 + Element Plus 2.9，并彻底根治「1920×1080 + 系统缩放 125%/150% 下元素被拉伸压扁」。
- **目标用户**：广州白云机场 T3 GTC 项目管理部运维人员（主）与部门查看者（次）；均非技术背景、重度 Excel 用户。
- **核心问题**：低有效视口（CSS 视口 1536×864 / 1280×720）下 SVG 与固定像素尺寸元素宽高比失真导致压扁；同时需把前端技术栈与既有 `tools-management/vue-frontend` 统一。

## 2. 交付范围（一期锁定 —— 不在此列表的一律不做）

| 优先级 | 功能 | 验收标准 | RICE |
|--------|------|----------|------|
| P0 | **F1 全局壳**：侧边栏（13 菜单项全量）+ 顶栏 + 面包屑 + 内容区滚动纪律 | AC-01 ~ AC-04 | 6.00 |
| P0 | **F2 资产总台账** `/asset/devices`：分页/筛选/排序/汇总卡片/详情抽屉 | AC-05 ~ AC-09 | 4.50 |
| P0 | **F5 检索** `/asset/search`：编号检索 + 资料域全局搜索 + 联想候选 | AC-10 ~ AC-12 | 4.00 |
| P0 | **多缩放零变形**（本轮立项理由，横切全部页面） | AC-13 ~ AC-16 | — |

**一期交付形态**：Vue 产物构建完成、本地 `npm run preview` 在 1280×720 与 1536×864 两档零变形、可发布到线上并可秒级回滚。**未在一期范围内的路由，其在壳内的菜单入口保留但页面实现按二期处理**（见 §7 期次列）。

## 3. 明确不做（锁定）

| 不做的内容 | 原因 | 何时考虑 |
|------------|------|----------|
| 后端 / API / `app.db` / 鉴权逻辑任何变更 | 用户红线 | 永不（本期） |
| 二期功能（资产可视化 9 视图、三维树、数据表管理、扫码盘点、二维码打印、导入、用户、设置、资料配置） | 决策 D2：先做一期，验收后重评 | 一期验收通过后 |
| 砍掉任何现有路由或子视图 | 决策 D1：全量等价迁移 | 永不 |
| 窄屏（<1280px）移动端排布与移动端 App/小程序 | 决策 D3：现场扫码由既有微信小程序承担 | 有真实移动端诉求时 |
| 暗黑模式 / 多主题 / i18n / SSR | 无真实需求 | Backlog |
| 新增业务能力（工单、备件、PM 计划、IoT） | 无对应 API，属新建 | 另立项目 |

## 4. 技术架构（版本锚定 —— 已对 npm registry 实测）

| 层 | 技术 | 实际版本（实测） | 锁定原因 |
|----|------|------------------|----------|
| 前端框架 | vue | `^3.5.0` → 解析 **3.5.42** | 与 `vue-frontend` 一致 |
| UI 组件库 | element-plus | `^2.9.0` → 解析 **2.14.5**（peer vue ^3.3.7） | 用户指定；生态成熟 |
| 路由 | vue-router | `^4.5.0` | 对齐既有工程；不上 5.x |
| 状态 | pinia | `^2.2.0` | 同上；不上 4.x |
| 构建 | vite | `^5.4.0` + `@vitejs/plugin-vue ^5.2.0` | 对齐既有工程；不上 8.x |
| 类型检查 | typescript `^5.9.3` + vue-tsc `^2.2.12` | — | `vue-tsc` 为构建必过门 |
| HTTP | axios `^1.7.0` | — | 对齐既有工程 |
| 图标（**全项目唯一**） | @element-plus/icons-vue | `^2.3.0` → 解析 **2.3.2**（peer vue ^3.2.0） | P0：禁 emoji、禁第二套库 |
| 图表 | echarts `^6.1.0` + vue-echarts `^8.3.0` | 6.1.0 / 8.3.0（peer echarts ^6.0.0 ✓） | 二期用；一期不引入 |
| 复用（框架无关） | html5-qrcode `^2.3.8`、xlsx `^0.18.5` | — | 扫码与 Excel 直接复用 |
| 部署 | 后端 FastAPI 托管静态 + `releases/` 符号链接切换 | — | 零 nginx 改动、秒级回滚 |

**构建脚本**：`"build": "vue-tsc && vite build"`；`base: '/ops/'`；产物输出到 `dist/`（页面 `/ops`，资源 `/ops/assets`）。

**目录分层（硬规则）**：`views → components|composables|stores|api → utils|types`，依赖只向下；**单文件 ≤300 行**；`main.ts` 只装配；页面只编排。详见 `ARCHITECTURE.md` §7。

## 5. API 端点清单（锁定 —— 开发唯一依据）

前缀 `API_BASE = '/ops/api'`，下表省略前缀；`BASE = '/assets'`。**★ = 一期需要**，其余为二期/三期保留清单（**不删、不改**）。

### 5.1 资产总台账（★ 一期）
| Method | Path | 功能 | 关键参数 |
|--------|------|------|----------|
| GET | `/assets/asset-ledger` | 总台账分页列表（devices ∪ 台账 records ∪ 固定资产） | 分页/筛选/排序参数，空值不下发 |
| GET | `/assets/asset-ledger/summary` | 规模/金额/区域/子系统/使用单位/保修预警汇总 | 同筛选参数 |
| GET | `/assets/asset-ledger/detail` | 单设备全字段详情（含跨表记录 + 关联链路） | `code` |
| GET | `/assets/asset-ledger/resolve` | 台账反查（走权威匹配内核，设备域与资料域双侧命中） | `q` |

### 5.2 检索（★ 一期）
| Method | Path | 功能 | 关键参数 |
|--------|------|------|----------|
| GET | `/assets/search` | 设备多维信息聚合检索 | `code`（**注意：不是 `q`，用 `q` 会 422**）、`depth` |
| GET | `/assets/search/suggest` | 搜索候选联想（devices 编号/名称 + 台账 records + 别名） | `q`、`limit` |
| GET | `/assets/link/global-search` | 全局资料表内容模糊搜索 | `q`、`limit` |

### 5.3 基础字典（★ 一期）
| Method | Path | 功能 |
|--------|------|------|
| GET | `/assets/subsystems` | 子系统列表（7 个） |
| GET | `/assets/tables` | 资料表列表（可选 `subsystem_id`） |
| GET | `/ops/api/rooms` | 房间列表（**挂在 main.py，不是 `/assets/rooms`**） |

### 5.4 二期/三期保留清单（实现按 §7 期次，契约不变）
`/assets/link/overview`、`/assets/link/table/{tid}`、`/assets/link/crossrefs`、`/assets/link/auto-rules`、`POST|DELETE /assets/link/auto-associate`、`/assets/link/manual-queue`、`POST /assets/link/manual-associate`、`/assets/link/device/{code}`、`/assets/trees/{area,subsystem,device,ba}`、`/assets/ba/problems`、`/assets/ba/overview`、`/assets/stats/by-subsystem-area`、`/assets/relations`、`/assets/devices`、`/assets/import-batches`、`/assets/import/templates`、`POST /assets/import`(multipart)、子系统/资料表/字段/记录全量 CRUD（`/assets/subsystems`、`/assets/tables/{tid}`、`/assets/tables/{tid}/fields`、`/assets/tables/{tid}/records`、`records/bulk`、`transfer-mapping`、`records/transfer`）。

### 5.5 HTTP 契约（不变量，必须复刻）
- 请求头 `Authorization: Bearer <token>`；token 存 `localStorage['token']`。
- 非 2xx：**422 的 `detail` 是数组**，须拼为 `loc.slice(1).join('.') + ': ' + msg`，多个用 `；` 连接；其余取 `detail || message || '请求失败 (status)'`。（对齐 `src/services/api.ts:45-57`）
- 上传走 `FormData` 直传，不经 JSON 序列化。

## 6. 数据库表清单（只读引用 —— 一行不动）

| 表 | 用途 | 一期读写 |
|----|------|----------|
| `devices` | 已登记设备 | 只读 |
| `records` | 动态资料记录（JSON `data` 列） | 只读 |
| `fixed_assets` | 固定资产 | 只读 |
| `subsystems` / `data_tables` / `field_defs` | 子系统与动态表结构 | 只读 |
| `rooms` | 房间（871+，小程序与外键依赖） | 只读 |
| `device_relations` | 设备关联边（`source=auto|manual`） | 只读 |

**纪律**：台账口径为 `devices ∪ records ∪ fixed_assets` 按 `device_code` 合并；一期前端不得自行拼口径，一律用 `/asset-ledger` 系列接口。`records.data` 是 JSON 列。

## 7. 页面清单（13 路由 + 9 子视图，全量保留）

| # | 路由 | 页面 | 期次 |
|---|------|------|------|
| 1 | `/dashboard` | 运维总览 | 一期（壳内占位页，保证可导航） |
| 2 | `/asset/devices` | **资产总台账** | **一期** |
| 3 | `/asset/search` | **检索** | **一期** |
| 4 | `/asset/ledger`、`/asset/ledger/:tableId` | 数据表管理 | 二期 |
| 5 | `/asset-viz`（9 子视图） | 资产可视化 | 二期 |
| 6 | `/asset/inventory` | 盘点 | 二期 |
| 7 | `/asset/qr-labels` | 二维码标签打印 | 三期 |
| 8 | `/qr/:code` | 扫码设备详情 | 二期 |
| 9 | `/asset/settings` | 资料配置 | 三期 |
| 10 | `/users` | 用户管理 | 三期 |
| 11 | `/settings` | 系统设置 | 三期 |
| 12 | `/cad` | CAD 图纸（菜单沿用现状隐藏，路由保留） | 三期 |
| 13 | `*` | 404 → `/dashboard` | **一期** |

### 7.1 一期菜单清单（9 项，与 React 版 `Sidebar.tsx:27-39` 一致）

| 菜单标签 | 路由 | 目标组件 | 管理员限定 |
|----------|------|----------|------------|
| 用户管理 | `/users` | 占位视图 | 是 |
| 系统设置 | `/settings` | 占位视图 | 否 |
| 资料检索 | `/asset/search` | **SearchView（一期实现）** | 否 |
| 数据表管理 | `/asset/ledger` | 占位视图 | 否 |
| 设备台账 | `/asset/devices` | **DeviceLedgerView（一期实现）** | 否 |
| 资产可视化 | `/asset-viz` | 占位视图 | 否 |
| 二维码标签 | `/asset/qr-labels` | 占位视图 | 否 |
| 扫码盘点 | `/asset/inventory` | 占位视图 | 否 |
| 资料配置 | `/asset/settings` | 占位视图 | 是 |

> 说明：`/cad` 的菜单项沿用 React 版现状**保持隐藏**（`Sidebar.tsx:28` 注释），但路由与页面在二期/三期等价迁移，不删代码。`/dashboard` 与 `/qr/:code` 不是菜单项（前者为默认落地页、后者为扫码深链页）。管理员限定沿用现状：生产 `DISABLE_AUTH=true` 下用户为 admin，9 项全部可见。

一期页面骨架：`MainLayout`（`el-container` + `el-aside` + `el-header` + `el-main`），**9 个菜单项全部渲染**（清单见 §7.1），未实现页面挂占位视图（禁止空洞占位文案，写"该功能计划于二期交付"）。

## 8. 设计 Token（锁定 —— 真源为 `design-tokens.css`）

落地路径 `src/styles/tokens.css`，`main.ts` **最后加载**（顺序：EP 组件样式 → EP component-size → tokens）。

| 类别 | 关键值 |
|------|--------|
| 主色 | `--accent: #2563EB`（hover `#6692F1` / active `#1E4FBC` / soft `#E9EFFD`） |
| 语义 | success `#16A34A` · warn `#D97706` · danger `#DC2626` · info `#0EA5E9`（各带 `-bg` / `-fg`） |
| 中性 | bg `#F5F7FA` · surface `#FFF` · fg `#303133` · fg-2 `#606266` · muted `#909399` · border `#DCDFE6` |
| 字号 | 12（全站下限）/ 13（表格单元）/ 14（正文基准）/ 16 / 18 / 20 / 24 / 30 |
| 字体 | Inter（拉丁数字，需 `tabular-nums`）+ 中文系统栈 + `--font-mono`（设备编号可辨 1/l/I 与 0/O） |
| 间距 | 4px 网格，仅允许 4/8/12/16/20/24/32/40/48/64 |
| 圆角 | 4 / 6 / 8 / 9999 |
| 外壳 | 侧栏 240px（折叠 64px）· 页头 56px（紧凑 48）· 工具条 40px（紧凑 32）· 行高 36px |
| 动效 | 120 / 160 / 240ms，`--ease-standard: cubic-bezier(.2,0,0,1)` |
| 断点 | xs<768 · sm 768–1023 · md 1024–1279 · **lg 1280–1535** · xl 1536–1919 · 2xl ≥1920 |

**Element Plus 映射**：全部 `--el-*` 变量（含 `light-3/5/7/8/9`、`dark-2`、`--el-component-size`、`--el-font-size-base`、`--el-border-radius-base`）必须在 tokens 文件中**显式给值**，否则 hover/plain/disabled 仍是 EP 默认 `#409EFF` 派生色。映射表见 `design-tokens.css`。

## 9. 验收标准（EARS 格式 —— QA 以此为准）

| 编号 | 功能 | EARS 验收标准 | 优先级 |
|------|------|---------------|--------|
| AC-01 | 外壳 | While 视口为 1280–1920 任一宽度，系统**必须**仅有一个页面级滚动条，侧栏与页头固定不滚 | P0 |
| AC-02 | 外壳 | When 视口宽度 < 1024px，侧栏**必须**折叠为图标条（64px），不得遮挡内容 | P0 |
| AC-03 | 外壳 | While 任一路由激活，对应当前路由的菜单项**必须**高亮，且 **9 个菜单项**全部可见可达（与 React 版 `Sidebar.tsx` 的 `menuItems` 一致） | P0 |
| AC-04 | 外壳 | If 访问不存在的路由，系统**必须**重定向到 `/dashboard`，不得白屏 | P0 |
| AC-05 | 总台账 | When 打开 `/asset/devices`，系统**必须**在 3s 内渲染首屏（分页，非全量 8455 条） | P0 |
| AC-06 | 总台账 | While 视口为 1280×720，台账表格**必须**在表格容器内横向滚动，**不得**撑宽整页 | P0 |
| AC-07 | 总台账 | When 用户修改任一筛选条件，表格**必须**回到第 1 页并重新请求 | P0 |
| AC-08 | 总台账 | When 用户对"金额/日期"列排序，空值**必须**恒排最后 | P0 |
| AC-09 | 总台账 | When 用户点击某行，系统**必须**打开详情抽屉并可从 URL（`?code=`）深链直达 | P1 |
| AC-10 | 检索 | When 输入编号并提交，系统**必须**同时命中设备域与资料域（走 `/assets/asset-ledger/resolve`） | P0 |
| AC-11 | 检索 | While 输入关键词，系统**必须**在 300ms 防抖后展示联想候选；空结果**必须**显示引导文案而非空白 | P1 |
| AC-12 | 检索 | If 编号含 `#`、`()` 等特殊字符，系统**必须**正确 URL 编码后请求 | P1 |
| AC-13 | 适配 | While 系统缩放为 100%/125%/150%（CSS 视口 1920/1536/1280），所有 SVG 与图表**必须**保持原始宽高比，**不得**出现拉伸或压扁 | **P0** |
| AC-14 | 适配 | While 任一视口宽度，**必须**无横向溢出（`documentElement.scrollWidth <= clientWidth`） | **P0** |
| AC-15 | 适配 | While 任一视口宽度，flex 行内含表格/长文本的子项**必须** `min-width:0`，不得撑破容器 | P0 |
| AC-16 | 适配 | When 浏览器窗口从 1920 连续缩到 1280，**必须**无元素重叠、无文字截断到不可读 | P0 |
| AC-17 | 错误 | If 接口返回 422 数组 detail，系统**必须**展示拼接后的可读消息，不得裸抛或白屏 | P0 |
| AC-18 | 图标 | While 扫描全部 `.vue` 文件，**必须**零 emoji 字符作为功能图标 | P0 |

## 10. 边界与约束

- 浏览器：Chrome / Edge / Firefox 最新 2 版；**不支持 IE**。
- 视口：**仅保证 ≥1280×720 桌面视口**；<1280px 仅需"不崩坏"，不作验收目标（决策 D3）。
- 性能：首屏 <3s；大表格必须分页；871 房间与 8455 台账**禁止**一次性全渲染。
- 空/加载/错误三态必做：`el-empty` + 引导文案、`v-loading`/骨架、全局 toast。
- 无登录态：沿现状（后端 `DISABLE_AUTH=true`），不新增登录页与守卫分支。
- 组件内禁止字面颜色（唯一例外 `#fff`/`#000`）、禁止 emoji 图标、禁止紫色→粉色渐变、禁止 `cubic-bezier(0.68,-0.55,0.265,1.55)` 弹跳缓动。

## 11. 内嵌已知坑（本项目实测，必须规避）

| 坑 | 指纹 | 根因 | 修法 |
|----|------|------|------|
| SVG 被压扁 | vue / svg | 同时写死 width/height 像素属性且只约束宽度 → 宽高比失真 | 只留 `viewBox` + `w-full h-auto`（或 `aspect-ratio`）；见 `ARCHITECTURE.md` §4.1 |
| 整页被撑宽 | el-table | 硬编码整表最小宽（如 `min-w-[1100px]`） | 列级 `min-width` + 局部 `overflow-x` |
| 滚动条逃逸到 body | el-container | flex 子项默认 `min-height:auto` | 内容区 `min-height:0` + `overflow:auto` |
| 422 报错不可读 | axios | `detail` 为数组未拼接 | 复刻既有拼接逻辑（§5.5） |
| `/search` 参数名 | fetch | 误用 `q` | 用 `code`（用 `q` 会 422）；`/search/suggest` 才用 `q` |
| 编号含特殊字符 | — | 未编码 | 一律 `encodeURIComponent` |
| 主题覆盖失效 | element-plus | 引入了 `element-plus/dist/index.css` 或顺序错 | 禁引 dist css；tokens 最后加载 |
| 图标库混用 | icons | DB `subsystems.icon` 存的是 lucide 名 | `SUBSYSTEM_ICON_MAP` 映射到 EP 图标 + 未命中回落 `Box` |
| 演示环境状态不同 | — | — | 前端一切数据经 `/ops/api`，不得用本地 mock 冒充 |

## 12. 端到端验证步骤

```bash
# 1) 类型检查 + 构建（vue-tsc 零错误为必过门）
npm run build

# 2) 本地预览（preview 已代理 /ops/api → 127.0.0.1:9527）
npm run preview

# 3) 适配验收（核心）：浏览器 DevTools 固定两档视口
#    1280×720  与  1536×864
#    断言 1：document.documentElement.scrollWidth <= document.documentElement.clientWidth
#    断言 2：逐个 svg 元素 —— el.getBoundingClientRect() 宽高比 == viewBox 宽高比（容差 1%）
#    断言 3：13 条路由逐一走查，无元素重叠、无文字不可读

# 4) 核心成功流
#    /ops/dashboard 加载 → /asset/devices 列表分页 → 改筛选回第 1 页
#    → 金额列排序（空值恒最后） → 打开详情抽屉（URL 出现 ?code=） → 刷新页面仍可直接打开

# 5) 关键错误流
#    构造 422（如 /assets/asset-ledger 传非法分页值）→ 前端展示拼接后的可读消息，不白屏

# 6) 发布与回滚演练
#    ln -sfn releases/vue-<sha> dist      # 发布
#    ln -sfn releases/react-<sha> dist    # 回滚（首次发布前必须先归档现网 React 产物）
#    两者均访问 https://82.156.62.59/ops/ 复验第 4 步
```

**通过判定**：`vue-tsc` 零错误 + 第 3 步两档视口全绿 + 第 4/5 步复现无误 + 无 >300 行文件 + emoji 扫描零命中 + 颜色全走 Token。

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-09-17 | Spec v1.0 生成；一期锁定为「壳 + 资产总台账 + 检索」 | 用户决策 D1/D2/D3；Phase 1 三文档已确认 | 一期开发范围 |
| 2026-09-17 | 一期范围明确排除窄屏适配 | 决策 D3 | §10 边界、AC-13~16 |

## 14. 已登记偏差（Deviation Register）

> 记录实现与 Spec 的已知不一致，供后续期次收口。**不隐瞒、不留白**：每条须有现象、原因、影响、收口时机。

| 编号 | 项 | Spec 要求 | 实现现状 | 原因 | 影响 | 收口时机 |
|------|----|-----------|----------|------|------|----------|
| D-01 | lg(1280–1535) 档台账表格 | `UIUX.md` §6.2 写死「列裁剪：保留 4–6 关键列 + 列设置抽屉（localStorage 偏好）」 | 按视口裁列后保留 8 列，超出部分走**表格容器内横向滚动**（AC-06 明确允许），未实现「列设置」抽屉 | 该抽屉（含偏好持久化）不在派发给两位工程师的文件范围内；AC-06 已允许局部横滚 | 1280 档需在表格内左右滚动才能看到最右侧「资料 / 关联」列；**未见变形、破版或页面级溢出**（A1/A3/A4 实测通过） | 二期收敛为统一 DataTable 壳时实现 |
| D-02 | 检索页关联视图 | `UIUX.md` §8 该页右栏为「关联图谱」 | 以「关联设备列表（点编号可重检索）」替代，未绘制图谱 | 图谱依赖壳层 `components/charts/ResponsiveSvg.vue`（尚未创建）；且图谱属二期「资产可视化」范围 | 一期可看到关联对象但无图形化链路 | 二期实现 `ResponsiveSvg.vue` 后接入 |
| D-03 | 子系统图标与分类色 | `UIUX.md` §4.2 的 `SUBSYSTEM_ICON_MAP`（lucide 名 → EP 图标）与 7 子系统分类色 | 一期直接输出后端 `subsystem_name` 文本，未做图标映射 | 映射表属共享组件，需先核对 DB `subsystems.icon` 全量取值（见 `OPEN-DECISIONS.md` OD-03，仍未闭合） | 子系统以文字呈现，视觉信息量略低 | OD-03 闭合后统一接入 |
| D-04 | sm/xs 档（<1024）侧栏 | `UIUX.md` §6.2：<1024 隐藏侧栏 + 页头汉堡抽屉 | 实现为 <1536 一律折叠为 64px 图标条，未做汉堡抽屉 | 决策 D3「完全不管窄屏」，保持实现简单 | 窄屏下侧栏为图标条而非完全隐藏 | 出现真实窄屏诉求时 |
| D-05 | 首屏 JS 体积 | `ARCHITECTURE.md` §9 第 6 条未设体积门槛，仅要求按路由分包 | 主 chunk `index-*.js` 1,207.95 kB / gzip 387.92 kB，触发 vite「chunks larger than 500 kB」警告 | `main.ts:22` 全量 `app.use(ElementPlus)` + `main.ts:25-27` 遍历注册全部 EP 图标，绕过 tree-shaking | 内网首屏多下载约 388 kB（gzip）；**功能与几何验收均不受影响** | 二期体积优化：删全局图标注册（各组件已显式 import）+ EP 组件按需引入 + `manualChunks` |
| D-06 | 资产可视化 `/asset-viz` 检索 Tab 的 `SearchResult` 双源 | 类型契约单一真源（`types/asset.ts`） | `api/search.ts` 返回 `types/search.ts` 的窄版 `SearchResult`，而 viz 视图按 `types/asset.ts` 的完整版消费；`views/viz/VizSearchTab.vue` 以 `as unknown as` 桥接 2 处 | `types/search.ts` 与 `types/asset.ts` 并存且未同步，属既有债；本模块未获授权改他人 `api` / `types` | 类型断言掩盖潜在契约漂移，字段缺失将表现为空值而非编译期报错（实测检索结果渲染正常） | 主理人收口：`types/search.ts` 并入 `types/asset.ts`，或 `api/search` 直接复用权威类型 |
| D-07 | 资产可视化 `/asset-viz` 路由未注册 | 9 个 Tab 应可经 `/asset-viz?tab=` 直达 | 13 个 `.vue`（9 Tab + `AreaTree`/`DeviceAttrPanel`/`RelationGraph`/`LinkEdgeGroup` 等子视图）已交付，路由注册归主理人 | 分工纪律：本模块不改 `router/`、`layouts/`、`App.vue`、`main.ts`、`styles/` | 路由接线前页面不可直达（不影响组件自身正确性） | 主理人在 `router/index.ts` 注册 `/asset-viz` 后关闭 |

### 14.1 实测证据（Phase 4 适配验收）

- 验收脚本：`vue-frontend/scripts/verify_ui.mjs`（几何断言，非肉眼判断）
- 报告与截图：`docs/rewrite-vue/verify_report.json`、`docs/rewrite-vue/shots/`
- 结果：**9/9 组合全绿**（3 视口 × 3 页面），`ALL_PASS=true`
  - A1 无页面级横向溢出 = true（全部）
  - **A2 无 SVG 压扁 = true（全部）** ← 本轮立项要根治的缺陷，已实测确认消除
  - A3 无元素越出视口右边界 = true（全部）
  - A4 无 body 级纵向滚动 = true（全部）
  - 判定口径补强：`allPass` 原先只纳入 A1/A2/A4，本轮已把 **A3 一并纳入**，避免「元素越界被漏判」
- 侧栏宽度实测：1280 → 64px、1536 → 240px、1920 → 240px，**精确符合 `UIUX.md` §6.2 行为矩阵**
- 真实数据渲染确认：资产总数 8,977 / 固定资产含税总额 ¥8.85 亿 / 有台账记录 8,915 / 保修已过期 126 / 共 180 页
- **console 错误 0 条、失败请求 0 条**（9/9 组合全部为空）：`index.html` 增补空 favicon（`<link rel="icon" href="data:," />`）后，浏览器默认探测 `/favicon.ico` 造成的唯一 404 已消除
- 复跑时间戳：`ranAt = 2026-09-17T06:55:24Z`；产物构建 `vite v5.4.21 · 1,715 modules · built in 8.78s`

### 14.2 质量门禁证据（对照 `ARCHITECTURE.md` §9 第 6 条）

| 门禁 | 判定口径 | 实测结果 |
|------|----------|----------|
| 构建 | `npm run build` = `vue-tsc && vite build` | **通过**，vue-tsc 零错误；vite v5.4.21 / 1,715 modules / 8.78s；已按路由分包（`DashboardView`、`SearchView`、`DeviceLedgerView`、`http` 各自独立 chunk） |
| 单文件 ≤300 行 | `ARCHITECTURE.md` §7 规则 2：**不计空行与注释行** | **超限文件数 = 0**；28 个 `src/**` 源文件，最大 `types/assetLedger.ts` 297 行（若按原始行数口径最大 369 行，差异全部来自空行与注释） |
| 目录依赖只向下 | `views → components\|api → api → types`；禁反向 import | **通过**：实测 `views → components/api/types`、`components → api/types`、`api → types`、`layouts → components`，无一处反向引用 |
| 图标唯一 | 仅 `@element-plus/icons-vue`（2.3.2），禁 emoji、禁第二套库 | **通过**：组件内 100% 显式 `import { … } from '@element-plus/icons-vue'`；全量 emoji 正则扫描 **0 命中** |
| 颜色 Token 化 | 组件内禁字面颜色（唯一例外 `#fff`/`#000`），一律 `var()` | **通过**：十六进制字面量**仅**存在于 `styles/tokens.css`（单一事实源），components / views / layouts **0 处硬编码** |
