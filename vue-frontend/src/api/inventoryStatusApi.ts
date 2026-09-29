/**
 * 设备台账 redesign · 盘点状态 API（SPEC §5.1 / §6.2，前端不得绕过）
 *   GET  /assets/asset-ledger                         分页列表（新增 inventory_status / source_kind 过滤）
 *   GET  /assets/asset-ledger/summary                 汇总（新增 inventory_status 子集计）
 *   PUT  /assets/asset-ledger/{device_code}/inventory-status   管理员覆盖写（逃生舱）
 *   DELETE /assets/asset-ledger/{device_code}/inventory-status   管理员覆盖撤销
 *
 * 本文件为**纯追加**——既有 src/api/assetLedger.ts（4 个只读端点）一行未改。
 * 复用 src/api/http.ts：Bearer 注入、422 detail 数组拼消息、queryOf() 空值不下发。
 * 编号经 axios params 传递（内部 encodeURIComponent），含 # / () 等特殊字符安全。
 *
 * 注意：PUT 请求体字段名沿用 SPEC §6.2 锁定契约 `{ "inventory_status": ..., "reason": ... }`
 *   （与架构 §11.4 草稿中的 `status` 字段命名不同，以前端唯一契约 SPEC 为准）。
 */
import http from './http'
import type {
  AssetLedgerListResult,
  AssetLedgerQuery,
  AssetLedgerSummary,
  AssetLedgerSummaryQuery,
  InventoryStatus,
  InventoryStatusClearResult,
  InventoryStatusOverrideResult,
} from '@/types/assetLedger'

const BASE = '/assets/asset-ledger'

/** 列表参数：逐字段显式列出，复用现有通道并追加 inventory_status / source_kind */
function listParams(query: AssetLedgerQuery): Record<string, unknown> {
  return {
    q: query.q,
    subsystem_id: query.subsystem_id,
    area: query.area,
    use_dept: query.use_dept,
    state: query.state,
    source: query.source,
    inventory_status: query.inventory_status,
    source_kind: query.source_kind,
    include_inactive: query.include_inactive ? true : undefined,
    sort: query.sort,
    order: query.order,
    page: query.page,
    page_size: query.page_size,
  }
}

/** 总台账分页列表（设备台账页 confirmed / 基础数据页 unconfirmed 共用，按 inventory_status 切视图） */
export function listAssetLedger(query: AssetLedgerQuery): Promise<AssetLedgerListResult> {
  return http.get<AssetLedgerListResult>(BASE, listParams(query))
}

/** 汇总：在后端签名的 4 个维度基础上追加 inventory_status（子集计，SPEC §4.3 / §5.1） */
export function getAssetLedgerSummary(query: AssetLedgerSummaryQuery): Promise<AssetLedgerSummary> {
  return http.get<AssetLedgerSummary>(`${BASE}/summary`, {
    q: query.q,
    subsystem_id: query.subsystem_id,
    area: query.area,
    use_dept: query.use_dept,
    inventory_status: query.inventory_status,
  })
}

/** 管理员覆盖写（逃生舱）：PUT 仅 admin 守护，非 admin → 403；reason 为空 → 400（SPEC §10 必填） */
export function putInventoryStatus(
  deviceCode: string,
  status: InventoryStatus,
  reason: string,
): Promise<InventoryStatusOverrideResult> {
  return http.put<InventoryStatusOverrideResult>(
    `${BASE}/${encodeURIComponent(deviceCode)}/inventory-status`,
    { inventory_status: status, reason },
  )
}

/** 管理员覆盖撤销（逃生舱）：DELETE 仅 admin 守护；不存在 → 200 幂等无操作 */
export function deleteInventoryStatus(deviceCode: string): Promise<InventoryStatusClearResult> {
  return http.delete<InventoryStatusClearResult>(
    `${BASE}/${encodeURIComponent(deviceCode)}/inventory-status`,
  )
}
