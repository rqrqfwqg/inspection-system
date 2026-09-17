// T3GTC 资产可视化系统 —— 类型定义
//
// 【注意】 契约纪律（2026-09-15 修正）
// ------------------------------------------------------------------
// 本文件曾自带一份 `/search` 的 SearchResult 复制品，且停留在**旧版契约**
// （`device` / `relations`），而后端早已换成
// `target` / `nodes` / `edges` / `groups` / `profile` / `power_chain`。
// 结果：设备详情抽屉里「基础信息」「关联设备」读到的永远是 undefined，
// 整页看起来「像死数据」——同一份后端数据在「资料检索」页却显示得满满当当。
//
// 现在**统一从 `@/types/asset` 复用权威契约**，本文件只保留可视化独有的类型，
// 从根上消灭重复定义带来的漂移。

// ==================== 复用权威契约（唯一真源） ====================
export type {
  Subsystem,
  SearchResult,
  SearchNode,
  SearchEdge,
  SearchGroup,
  SearchTableGroup,
  DeviceProfile,
  PowerChain,
  PowerChainNode,
  PowerChainEdge,
  RecordItem,
  DataTable,
  FieldDef,
  Device,
  DeviceRelation,
} from '@/types/asset'

// 超 300 行门禁按域拆分（字段未改），此处聚合导出保持 '@/types/assetViz' 导入路径不变：
export * from './viz-link'
export * from './viz-auto'
export * from './viz-device-link'
export * from './viz-trees'
export * from './viz-misc'
export * from './viz-import'
export * from './viz-resolve'
