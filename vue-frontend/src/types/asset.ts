// 分系统资料管理 · 前端类型定义（barrel，与后端 asset_schemas.py 一一对应）
// 原 asset.ts 超 300 行门禁，按域拆分：asset-core / asset-transfer / asset-search；
// 末段「资产总台账」类型与一期真源 assetLedger.ts 重复，已删除重复定义，统一从此导出。
export * from './asset-core'
export * from './asset-transfer'
export * from './asset-search'
export * from './assetLedger'
