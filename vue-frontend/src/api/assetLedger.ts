/**
 * 资产总台账 API（SPEC §5.1 的 4 个只读端点，前端不得绕过）
 *   GET /assets/asset-ledger            分页列表（devices ∪ 台账 records ∪ 固定资产）
 *   GET /assets/asset-ledger/summary    汇总（规模 / 金额 / 区域 / 子系统 / 使用单位 / 保修预警）
 *   GET /assets/asset-ledger/detail     单设备全字段详情（?code=）
 *   GET /assets/asset-ledger/resolve    台账反查（?q=，走后端权威匹配内核）
 *
 * 复用 src/api/http.ts：Bearer 注入、422 detail 数组拼消息、SPA catch-all 防 HTML、
 *   以及 queryOf() —— 空值（undefined / null / ''）不下发，避免把空筛选当成条件发给后端。
 * 编号一律经 axios params 传递（内部 encodeURIComponent），含 # / () 等特殊字符安全。
 */
import http from './http'
import type {
  AssetLedgerDetail,
  AssetLedgerListResult,
  AssetLedgerQuery,
  AssetLedgerSummary,
  AssetLedgerSummaryQuery,
  LedgerResolveResult,
} from '@/types/assetLedger'

const BASE = '/assets/asset-ledger'

/** 列表参数：逐字段显式列出，防止页面状态里的 UI 字段（如 hasFilters）漏进查询串 */
function listParams(query: AssetLedgerQuery): Record<string, unknown> {
  return {
    q: query.q,
    subsystem_id: query.subsystem_id,
    area: query.area,
    use_dept: query.use_dept,
    state: query.state,
    source: query.source,
    include_inactive: query.include_inactive ? true : undefined,
    sort: query.sort,
    order: query.order,
    page: query.page,
    page_size: query.page_size,
  }
}

/** 总台账分页列表 */
export function listAssetLedger(query: AssetLedgerQuery): Promise<AssetLedgerListResult> {
  return http.get<AssetLedgerListResult>(BASE, listParams(query))
}

/** 汇总：只下发后端签名的 4 个维度（不含 state / sort / page） */
export function getAssetLedgerSummary(query: AssetLedgerSummaryQuery): Promise<AssetLedgerSummary> {
  return http.get<AssetLedgerSummary>(`${BASE}/summary`, {
    q: query.q,
    subsystem_id: query.subsystem_id,
    area: query.area,
    use_dept: query.use_dept,
  })
}

/** 单设备全字段详情（未登记 devices、只在台账的编号同样可查） */
export function getAssetLedgerDetail(code: string): Promise<AssetLedgerDetail> {
  return http.get<AssetLedgerDetail>(`${BASE}/detail`, { code })
}

/** 台账反查：输入机身编码 / 设备编号 / 别名，由后端匹配内核给出候选（已排序，前端不重排） */
export function resolveAssetLedgerCode(q: string, limit = 5): Promise<LedgerResolveResult> {
  return http.get<LedgerResolveResult>(`${BASE}/resolve`, { q, limit })
}
