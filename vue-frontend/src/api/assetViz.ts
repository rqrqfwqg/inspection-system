/**
 * 资产可视化 API（联动画像 / 各类树 / BA / 统计 / 导入 / 现场定位观测）
 * =====================================================================
 * 来源：React 版 `src/features/assets/api.ts`，**逐方法等价迁移**。
 *
 * 与既有模块的职责边界（**去重**）：
 *   - `/assets/link/global-search`        → `@/api/search#globalSearch`
 *   - `/assets/search`                    → `@/api/search#searchDevice`
 *   - `/assets/asset-ledger/resolve`      → `@/api/assetLedger#resolveAssetLedgerCode`
 *   - `/assets/subsystems`（只读字典）    → `@/api/dict#listSubsystems`
 *   本文件只承担可视化域独有端点。
 *
 * 纪律：`POST /assets/import` 走 `FormData` **直传**（不经 JSON 序列化），
 * 与 React 版同模式；其余全部经 `@/api/http`。
 */
import http from './http'
import { API_BASE } from '@/config'
import type {
  AreaNode,
  SubsystemNode,
  BaProblemsResponse,
  BaOverviewItem,
  StatRow,
  RelationEdge,
  DeviceLite,
  ImportBatch,
  ImportResult,
  ImportTemplate,
  DeviceHierarchyNode,
  BaSystemNode,
  LinkOverview,
  LinkTableDetail,
  AutoRulesResponse,
  AutoAssociatePreview,
  AutoAssociateResult,
  ManualQueueResponse,
  ManualAssociateResult,
  DeviceLinkResponse,
  CrossRefResponse,
  GeoObservation,
} from '@/types/assetViz'

const BASE = '/assets'

/** GET /link/overview —— 全局联动画像（资料表 ↔ 设备 ↔ 关联）。 */
export function getLinkOverview(): Promise<LinkOverview> {
  return http.get<LinkOverview>(`${BASE}/link/overview`)
}

/** GET /link/table/{tid} —— 单张资料表的画像（覆盖率 + 每个字段的真实填充率 + 未解析 TOP）。 */
export function getLinkTable(tableId: number): Promise<LinkTableDetail> {
  return http.get<LinkTableDetail>(`${BASE}/link/table/${tableId}`)
}

/** GET /link/crossrefs —— 跨表字段关联：拿记录的编号值到其他启用资料表搜索命中 */
export function getCrossRefs(tableId: number, recordId: number): Promise<CrossRefResponse> {
  return http.get<CrossRefResponse>(
    `${BASE}/link/crossrefs?table_id=${tableId}&record_id=${recordId}`,
  )
}

/** GET /link/auto-rules —— 自动关联规则清单与候选规模（预览，不写库）。 */
export function getAutoRules(): Promise<AutoRulesResponse> {
  return http.get<AutoRulesResponse>(`${BASE}/link/auto-rules`)
}

/** POST /link/auto-associate —— 执行自动关联（dryRun=true 仅预览；ruleIds 可只跑指定规则）。 */
export function runAutoAssociate(
  opts: { ruleIds?: string[]; dryRun?: boolean; limit?: number } = {},
): Promise<AutoAssociatePreview | AutoAssociateResult> {
  return http.post<AutoAssociatePreview | AutoAssociateResult>(`${BASE}/link/auto-associate`, {
    rule_ids: opts.ruleIds,
    dry_run: !!opts.dryRun,
    limit: opts.limit,
  })
}

/** DELETE /link/auto-associate —— 回滚自动关联（只删 source=auto，绝不误删人工关联）。 */
export function rollbackAutoAssociate(
  opts: { batch?: string; rule?: string } = {},
): Promise<{ deleted: number; batch: string | null; rule: string | null }> {
  const q = new URLSearchParams()
  if (opts.batch) q.set('batch', opts.batch)
  if (opts.rule) q.set('rule', opts.rule)
  const s = q.toString()
  return http.delete<{ deleted: number; batch: string | null; rule: string | null }>(
    `${BASE}/link/auto-associate${s ? '?' + s : ''}`,
  )
}

/** GET /link/manual-queue —— 无法自动关联的编号队列（含候选建议）。 */
export function getManualQueue(
  opts: { limit?: number; tableId?: number } = {},
): Promise<ManualQueueResponse> {
  const q = new URLSearchParams()
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.tableId) q.set('only_table', String(opts.tableId))
  const s = q.toString()
  return http.get<ManualQueueResponse>(`${BASE}/link/manual-queue${s ? '?' + s : ''}`)
}

/** POST /link/manual-associate —— 人工建边（端点放宽：设备 / 机房 / 资料域编号均可）。 */
export function manualAssociate(body: {
  fromCode: string
  toCode: string
  relationType: string
  operator?: string
  note?: string
}): Promise<ManualAssociateResult> {
  return http.post<ManualAssociateResult>(`${BASE}/link/manual-associate`, {
    from_code: body.fromCode,
    to_code: body.toCode,
    relation_type: body.relationType,
    operator: body.operator,
    note: body.note,
  })
}

/** GET /link/device/{code} —— 单设备（或机房）的联动总览：资料记录 + 关联边（自动/人工）+ 分组。 */
export function getDeviceLink(code: string): Promise<DeviceLinkResponse> {
  return http.get<DeviceLinkResponse>(`${BASE}/link/device/${encodeURIComponent(code)}`)
}

/**
 * GET /trees/area?parent= —— 区域树逐级下钻（楼栋→楼层→房间类型组→机房→设备）
 *
 * 房间节点 label 为「空调机房（GE1F-KTJF-101）」格式；count 为真实归属设备数
 * （relations 所在机房边 + 台账房间字段 + 非 fuzzy 的 room_id）。
 */
export function getAreaTree(
  parent?: string,
  opts: {
    keyword?: string
    onlyWithDevices?: boolean
    building?: string
    /** 楼层下是否插入「同类型房间分组」一层（后端默认 true，仅在关闭时下发） */
    groupByType?: boolean
  } = {},
): Promise<AreaNode[]> {
  const p = new URLSearchParams()
  if (parent) p.set('parent', parent)
  if (opts.keyword) p.set('keyword', opts.keyword)
  if (opts.onlyWithDevices) p.set('only_with_devices', 'true')
  if (opts.building) p.set('building', opts.building)
  if (opts.groupByType === false) p.set('group_by_type', 'false')
  const q = p.toString()
  return http.get<AreaNode[]>(`${BASE}/trees/area${q ? `?${q}` : ''}`)
}

/** GET /trees/subsystem?parent= —— 子系统树逐级下钻（子系统→分类→设备 / 供电分层 / 资料表） */
export function getSubsystemTree(parent?: string): Promise<SubsystemNode[]> {
  const q = parent ? `?parent=${encodeURIComponent(parent)}` : ''
  return http.get<SubsystemNode[]>(`${BASE}/trees/subsystem${q}`)
}

/** GET /trees/device?parent= —— 设备层级树逐级下钻（按子系统分组 → 主设备 → 配件/子设备） */
export function getDeviceTree(parent?: string): Promise<DeviceHierarchyNode[]> {
  const q = parent ? `?parent=${encodeURIComponent(parent)}` : ''
  return http.get<DeviceHierarchyNode[]>(`${BASE}/trees/device${q}`)
}

/** GET /trees/ba?parent= —— BA 系统树逐级下钻（BA 系统 → 设备） */
export function getBaSystemTree(parent?: string): Promise<BaSystemNode[]> {
  const q = parent ? `?parent=${encodeURIComponent(parent)}` : ''
  return http.get<BaSystemNode[]>(`${BASE}/trees/ba${q}`)
}

/** GET /ba/problems —— BA 问题列表（支持按 ba_system / status / device_code 过滤） */
export interface BaProblemsParams {
  ba_system?: string
  status?: string
  page?: number
  page_size?: number
  device_code?: string
}

export function getBaProblems(params: BaProblemsParams = {}): Promise<BaProblemsResponse> {
  const q = new URLSearchParams()
  if (params.ba_system) q.set('ba_system', params.ba_system)
  if (params.status) q.set('status', params.status)
  if (params.device_code) q.set('device_code', params.device_code)
  q.set('page', String(params.page ?? 1))
  q.set('page_size', String(params.page_size ?? 50))
  return http.get<BaProblemsResponse>(`${BASE}/ba/problems?${q.toString()}`)
}

/** GET /ba/overview —— BA 设备总览 + 故障率 */
export function getBaOverview(): Promise<BaOverviewItem[]> {
  return http.get<BaOverviewItem[]>(`${BASE}/ba/overview`)
}

/** GET /stats/by-subsystem-area —— 子系统 × 区域 交叉计数与金额 */
export function getStatsBySubsystemArea(): Promise<{ rows: StatRow[] }> {
  return http.get<{ rows: StatRow[] }>(`${BASE}/stats/by-subsystem-area`)
}

/** GET /relations?from_code=&to_code= —— 设备关联边 */
export function getRelations(
  params: { from_code?: string; to_code?: string } = {},
): Promise<RelationEdge[]> {
  const q = new URLSearchParams()
  if (params.from_code) q.set('from_code', params.from_code)
  if (params.to_code) q.set('to_code', params.to_code)
  const s = q.toString()
  return http.get<RelationEdge[]>(`${BASE}/relations${s ? '?' + s : ''}`)
}

/** GET /devices?q=&subsystem_id= —— 设备下拉/补全 */
export function getDevices(
  params: { q?: string; subsystem_id?: number } = {},
): Promise<DeviceLite[]> {
  const q = new URLSearchParams()
  if (params.q) q.set('q', params.q)
  if (params.subsystem_id !== undefined) q.set('subsystem_id', String(params.subsystem_id))
  const s = q.toString()
  return http.get<DeviceLite[]>(`${BASE}/devices${s ? '?' + s : ''}`)
}

/**
 * GET /import-batches —— 导入批次列表（按时间倒序）。
 * 后端若未提供该接口，静默兜底返回空数组（不阻断页面）。
 */
export async function getImportBatches(): Promise<ImportBatch[]> {
  try {
    return await http.get<ImportBatch[]>(`${BASE}/import-batches`)
  } catch {
    return []
  }
}

/** GET /import/templates —— 支持导入的模板类型与说明。 */
export async function getImportTemplates(): Promise<ImportTemplate[]> {
  try {
    return await http.get<ImportTemplate[]>(`${BASE}/import/templates`)
  } catch {
    return []
  }
}

/**
 * POST /import —— 上传 Excel 并导入（自动识别模板；dryRun 仅校验不落库）。
 * 用 FormData + fetch 直传（不经 http 的 JSON 序列化），与 React 版同模式。
 */
export async function uploadImport(
  file: File,
  opts: { sourceType?: string; dryRun?: boolean } = {},
): Promise<ImportResult> {
  const formData = new FormData()
  formData.append('file', file)
  if (opts.sourceType) formData.append('source_type', opts.sourceType)
  if (opts.dryRun) formData.append('dry_run', 'true')

  const headers: Record<string, string> = {}
  const token = localStorage.getItem('token')
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${API_BASE}${BASE}/import`, {
    method: 'POST',
    headers,
    body: formData,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: '导入失败' }))
    const detail = error?.detail
    const msg = typeof detail === 'string' ? detail : JSON.stringify(detail)
    throw new Error(msg || '导入失败')
  }
  return response.json()
}

/**
 * GET /asset-ledger/geo-observations?device_code=&limit= —— 该设备的扫码现场定位（最新在前）。
 *
 * 后端按 `created_at DESC, id DESC` 返回；`created_at` 可能是进程启动时刻的冻结值，
 * 因此**前端再按 `observed_at` 倒序**（空值恒排最后，符合项目排序铁律）。
 * 接口不可用时静默返回空数组 —— 定位区块缺数据不该拖垮整个设备详情。
 */
export async function getGeoObservations(deviceCode: string, limit = 20): Promise<GeoObservation[]> {
  if (!deviceCode) return []
  const n = Math.max(1, Math.min(Number(limit) || 20, 200))
  try {
    const rows = await http.get<GeoObservation[]>(`${BASE}/asset-ledger/geo-observations`, {
      device_code: deviceCode,
      limit: n,
    })
    if (!Array.isArray(rows)) return []
    return [...rows].sort((a, b) => {
      const ta = Date.parse(String(a.observed_at ?? '')) || 0
      const tb = Date.parse(String(b.observed_at ?? '')) || 0
      if (!ta && !tb) return (b.id ?? 0) - (a.id ?? 0)
      if (!ta) return 1
      if (!tb) return -1
      return tb - ta
    })
  } catch {
    return []
  }
}
