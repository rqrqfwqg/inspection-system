import http from './http'

/** 子系统（7 个） */
export interface Subsystem {
  id: number
  code: string
  name: string
  /** DB 里存的是 lucide 图标名，前端须经 SUBSYSTEM_ICON_MAP 映射到 EP 图标 */
  icon?: string | null
  sort_order?: number | null
  is_active?: number | null
  description?: string | null
}

/** GET /assets/subsystems —— 子系统列表（与 React 版 assetApi.listSubsystems 同源） */
export function listSubsystems(): Promise<Subsystem[]> {
  return http.get<Subsystem[]>('/assets/subsystems')
}
