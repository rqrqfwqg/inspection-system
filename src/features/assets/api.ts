// T3GTC 资产可视化系统 —— API 客户端
// 基于项目既有 ApiService（src/services/api.ts）发送请求，不改动后端。
import { api } from '@/services/api'
import { API_BASE } from '@/config'
import type {
  Subsystem,
  AreaNode,
  AreaStats,
  SubsystemNode,
  SearchResult,
  BaProblemsResponse,
  BaOverviewItem,
  StatRow,
  RelationEdge,
  DeviceLite,
  ImportBatch,
  DeviceHierarchyNode,
  BaSystemNode,
  ImportResult,
  ImportTemplate,
} from './types'

const BASE = '/assets'

/** GET /subsystems —— 7 个子系统（power/fire/weak/lighting/water/hvac/other） */
export async function getSubsystems(): Promise<Subsystem[]> {
  return api.get<Subsystem[]>(`${BASE}/subsystems`)
}

/** GET /trees/area?parent= —— 区域树逐级下钻（楼栋→楼层→房间→设备）
 *
 * 房间节点 label 为「空调机房（GE1F-KTJF-101）」格式；count 为真实归属设备数
 * （relations 所在机房边 + 台账房间字段 + 非 fuzzy 的 room_id）。
 */
export async function getAreaTree(
  parent?: string,
  opts: { keyword?: string; onlyWithDevices?: boolean; building?: string } = {}
): Promise<AreaNode[]> {
  const p = new URLSearchParams()
  if (parent) p.set('parent', parent)
  if (opts.keyword) p.set('keyword', opts.keyword)
  if (opts.onlyWithDevices) p.set('only_with_devices', 'true')
  if (opts.building) p.set('building', opts.building)
  const q = p.toString()
  return api.get<AreaNode[]>(`${BASE}/trees/area${q ? `?${q}` : ''}`)
}

/** GET /areas/stats —— 区域多维统计（楼栋×楼层矩阵 / 子系统 / 机房类型 / 覆盖率） */
export async function getAreaStats(building?: string): Promise<AreaStats> {
  const q = building ? `?building=${encodeURIComponent(building)}` : ''
  return api.get<AreaStats>(`${BASE}/areas/stats${q}`)
}

/** GET /trees/subsystem?parent= —— 子系统树逐级下钻（子系统→分类→设备） */
export async function getSubsystemTree(parent?: string): Promise<SubsystemNode[]> {
  const q = parent ? `?parent=${encodeURIComponent(parent)}` : ''
  return api.get<SubsystemNode[]>(`${BASE}/trees/subsystem${q}`)
}

/** GET /search?code= —— 设备多维信息聚合检索 */
export async function searchDevice(code: string): Promise<SearchResult> {
  return api.get<SearchResult>(`${BASE}/search?code=${encodeURIComponent(code)}`)
}

/** GET /ba/problems —— BA 问题列表（支持按 ba_system / status / device_code 过滤） */
export interface BaProblemsParams {
  ba_system?: string
  status?: string
  page?: number
  page_size?: number
  device_code?: string
}

export async function getBaProblems(params: BaProblemsParams = {}): Promise<BaProblemsResponse> {
  const q = new URLSearchParams()
  if (params.ba_system) q.set('ba_system', params.ba_system)
  if (params.status) q.set('status', params.status)
  if (params.device_code) q.set('device_code', params.device_code)
  q.set('page', String(params.page ?? 1))
  q.set('page_size', String(params.page_size ?? 50))
  return api.get<BaProblemsResponse>(`${BASE}/ba/problems?${q.toString()}`)
}

/** GET /ba/overview —— BA 设备总览 + 故障率 */
export async function getBaOverview(): Promise<BaOverviewItem[]> {
  return api.get<BaOverviewItem[]>(`${BASE}/ba/overview`)
}

/** GET /stats/by-subsystem-area —— 子系统 × 区域 交叉计数与金额 */
export async function getStatsBySubsystemArea(): Promise<{ rows: StatRow[] }> {
  return api.get<{ rows: StatRow[] }>(`${BASE}/stats/by-subsystem-area`)
}

/** GET /relations?from_code=&to_code= —— 设备关联边 */
export async function getRelations(params: { from_code?: string; to_code?: string } = {}): Promise<RelationEdge[]> {
  const q = new URLSearchParams()
  if (params.from_code) q.set('from_code', params.from_code)
  if (params.to_code) q.set('to_code', params.to_code)
  const s = q.toString()
  return api.get<RelationEdge[]>(`${BASE}/relations${s ? '?' + s : ''}`)
}

/** GET /devices?q=&subsystem_id= —— 设备下拉/补全 */
export async function getDevices(params: { q?: string; subsystem_id?: number } = {}): Promise<DeviceLite[]> {
  const q = new URLSearchParams()
  if (params.q) q.set('q', params.q)
  if (params.subsystem_id !== undefined) q.set('subsystem_id', String(params.subsystem_id))
  const s = q.toString()
  return api.get<DeviceLite[]>(`${BASE}/devices${s ? '?' + s : ''}`)
}

/**
 * GET /import-batches —— 导入批次列表（按时间倒序）。
 * 后端若未提供该接口，静默兜底返回空数组（不阻断页面）。
 */
export async function getImportBatches(): Promise<ImportBatch[]> {
  try {
    return await api.get<ImportBatch[]>(`${BASE}/import-batches`)
  } catch {
    return []
  }
}

/** GET /import/templates —— 支持导入的模板类型与说明。 */
export async function getImportTemplates(): Promise<ImportTemplate[]> {
  try {
    return await api.get<ImportTemplate[]>(`${BASE}/import/templates`)
  } catch {
    return []
  }
}

/**
 * POST /import —— 上传 Excel 并导入（自动识别模板；dryRun 仅校验不落库）。
 * 用 FormData + fetch 直传（与 src/services/api.ts 的 uploadShiftImage 同模式），
 * 不经过 ApiService.request 的 JSON 序列化。
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
  const token = (api as unknown as { _token?: string | null })._token
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

/** GET /trees/device?parent= —— 设备层级树逐级下钻（按子系统分组 → 主设备 → 配件/子设备） */
export async function getDeviceTree(parent?: string): Promise<DeviceHierarchyNode[]> {
  const q = parent ? `?parent=${encodeURIComponent(parent)}` : ''
  return api.get<DeviceHierarchyNode[]>(`${BASE}/trees/device${q}`)
}

/** GET /trees/ba?parent= —— BA 系统树逐级下钻（BA 系统 → 设备） */
export async function getBaSystemTree(parent?: string): Promise<BaSystemNode[]> {
  const q = parent ? `?parent=${encodeURIComponent(parent)}` : ''
  return api.get<BaSystemNode[]>(`${BASE}/trees/ba${q}`)
}
