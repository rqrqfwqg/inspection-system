# 悬而未决登记册 · inspection-system 前端重写

> 记录 Phase 1 无法当场闭合、又不阻塞重写启动的决策项。每项必须有 Owner 倾向与闭合条件，避免沉没。

| Date | Source | Open Item | Related Constraints | Current Leaning | Blocked By | Resolves When | Status |
|------|--------|-----------|---------------------|-----------------|------------|---------------|--------|
| 2026-05-21 | npm registry 实测 | 是否跟随大版本 latest（vue-router 5.3.1 / pinia 4.0.3 / vite 8.3.0）而非对齐 vue-frontend 的 4.5/2.2/5.4 | 用户"技术栈统一"诉求；团队熟悉度权重高；vite8 要求 node ≥22.12 | **对齐 vue-frontend**（4.5/2.2/5.4），不追 latest | 无 | 若两工程合并升级计划确立 | Open |
| 2026-05-21 | 现状 `recharts 2.15` | 图表栈选型：`echarts`+`vue-echarts` vs `@antv/g2` vs 纯手写 SVG | 需覆盖 Dashboard 与 9 个 viz Tab；禁 hardcode 颜色；需 Token 化 | **echarts ^6.1.0 + vue-echarts ^8.3.0**（已查 npm 实录 6.1.0 / 8.3.0，peer 匹配） | 体积与按需引入方案待定 | 出 ADR-002（图表栈）并锁定按需引入清单 | Open |
| 2026-05-21 | `UIUX.md` §4.2 + npm 实测 | 子系统图标：DB `subsystems.icon` 存 **lucide 名**（如 `Zap`/`Flame`）而图标库锁 EP（**禁改后端**）；且 EP 无"消防/火焰"语义图标 | 后端/数据红线；P0 唯一图标库；与 `vue-frontend` 一致 | `SUBSYSTEM_ICON_MAP` 映射到 EP 图标 + `IconFlame.vue` 自补（见 UIUX §4.2） | 需核对 DB 现存 icon 全量取值 | Phase 2 生成映射表并校验 EP 图标名存在 | Open |
| 2026-05-21 | 服务器 env | 服务器 Node 版本是否满足 vite 5.4 与 vue-tsc 2.2 的 engines | 受限子账号；`server-setup.sh` 装 node22（据 memory 2026-07-13） | 假定 node ≥20；以 `node -v` 实测为准 | 需远程通道读取服务器实际 node 版本 | TAT/SSH 执行 `node -v` 确认 | Open |
| 2026-05-21 | 部署架构 | 静态产物由后端托管（现状）还是改由 nginx 直出 `/ops/` | 同机物料系统共用 443/nginx；改动有隔离风险 | **保留后端托管** + 符号链接切换（零 nginx 改动） | 无 | 若静态性能成为瓶颈再评估 | Open |
| 2026-05-21 | 代码审阅 | 存量 P0 违规需清理：`Header.tsx:45` 紫蓝渐变头像、`RelationGraph.tsx` 内联 hex、`index.css:6` Tailwind v4 死指令、`DeviceLedgerPage.tsx:756` 硬编码宽度 | P0 规则（禁紫粉渐变/禁硬编码色） | 重写时随各视图改写一并清除 | 依赖对应视图重写进度 | 对应视图 Phase 2 完成时 | Open |
| 2026-05-21 | 交互现状 | 现无登录页（`DISABLE_AUTH=true` 自动 admin）；重写是否保留无登录态 | 后端鉴权为红线不可动 | **保持无登录态**，与现状一致 | 无 | Phase 2 路由守卫实现时确认 | Open |
| 2026-05-21 | 依赖迁移 | `qrcode.react 4.2`（React）在 Vue 侧的二维码生成替代；`jsbarcode` 是否引入（vue-frontend 已有） | 二维码/条码标签打印为既有功能 | 生成侧优先复用 `vue-frontend` 的 `jsbarcode` 或纯 SVG 方案 | 标签打印精度需真机验证 | Phase 2 QrLabelView 实现时 | Open |
| 2026-09-17 | 用户决策 D1 | 功能范围：全量等价迁移 vs PRD 提议的合并/裁剪（CAD、系统设置、attr/ba/link 三 Tab、检索收敛） | 用户明确要求"13 路由 + 9 子视图一个不少，只换技术栈" | **全量等价迁移**：上述保留项全部按必须保留执行 | 无 | 已闭合 —— 即为 Spec 的锁定范围 | Closed |
| 2026-09-17 | 用户决策 D2 | 交付期次：按 PRD 三期全推进 vs 先做一期 | 现有 8455 条资产在线上运行，不能停摆；用户要求小步快跑 | **先只做一期**（全局壳 + 资产总台账 + 检索），验收通过后再评估后续期次 | 一期验收结果 | 一期在 1280×720 / 1536×864 两档零变形验收通过 | Decided |
| 2026-09-17 | 用户决策 D3 | 窄屏/移动端是否适配 | 现场扫码已由既有微信小程序承担，Web 端不重复投入 | **完全不管窄屏**，仅保证 ≥1280×720 桌面视口 | 无 | 已闭合 —— 已写入 ARCHITECTURE §4.4/§10 与验收标准 | Closed |

## 说明
- **Status** 取值：`Open`（待决策）/ `Decided`（已定，待落 ADR）/ `Closed`（已闭合，附结论）。
- 本登记册由架构师维护；主理人（项目总监）对"Blocked By 需外部输入"项统一对外协调。
