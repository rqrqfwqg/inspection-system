/**
 * CAD 图纸处理 API（/ops/api/cad/*）
 * =====================================================================
 * 来源：React 版 `src/pages/CADPage.tsx` 内联的 fetch/api 调用，等价收敛到 api 层。
 * 契约对照 `backend/cad_routes.py`（只读核对，后端一行不动）：
 *   POST   /cad/upload              → CADUploadResponse { success, message, file_id? }
 *   GET    /cad/files               → { files: CADFile[] }
 *   GET    /cad/parse/{file_id}     → CADAnalysisResponse（**平铺结构**：success/filename/version/... 直接在根上，
 *                                     React 版误按 {success, data} 取 `data` 字段——那是与后端不符的陈旧写法，此处纠正）
 *   GET    /cad/text/{file_id}      → CADTextResponse { success, filename, text_count, texts: CadTextItem[] }
 *   DELETE /cad/files/{file_id}     → { success, message }
 *   GET    /cad/export/json/{file_id}?download=true → FileResponse（二进制下载，走原生 fetch 拿 blob）
 *
 * 【易错】file_id 形如 `{8字节hex}_{原始文件名}`，含空格/中文/括号，拼 URL 必须 encodeURIComponent
 * （React 版未编码，文件名带特殊字符时 parse/text/delete 全部 404，此处一并纠正）。
 */
import http from './http'
import { API_BASE } from '@/config'

export interface CadFile {
  file_id: string
  filename: string
  size: number
  /** Unix 秒级时间戳 */
  upload_time: number
}

export interface CadBoundingBox {
  width: number
  height: number
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

export interface CadLayer {
  name: string
  color: number
  linetype?: string
  is_visible?: boolean
  entity_count: number
}

/** GET /cad/parse 响应（后端平铺返回，无 data 包裹） */
export interface CadAnalysis {
  success: boolean
  filename: string
  version: string
  total_entities: number
  entity_types: Record<string, number>
  bounding_box: CadBoundingBox
  layers: CadLayer[]
}

export interface CadTextItem {
  text: string
  layer: string
  coordinates?: Record<string, unknown>
  handle?: string
}

export interface CadTextResult {
  success: boolean
  filename: string
  text_count: number
  texts: CadTextItem[]
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** POST /cad/upload —— DXF 直传（multipart，不经 JSON 序列化） */
export async function uploadCadFile(file: File): Promise<{ success: boolean; message: string; file_id?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const resp = await fetch(`${API_BASE}/cad/upload`, { method: 'POST', headers: authHeaders(), body: formData })
  const data = (await resp.json().catch(() => ({}))) as { success?: boolean; message?: string; detail?: string; file_id?: string }
  if (!resp.ok || !data.success) {
    throw new Error(data.detail || data.message || `上传失败 (${resp.status})`)
  }
  return { success: true, message: data.message || '上传成功', file_id: data.file_id }
}

/** GET /cad/files —— 已上传文件清单 */
export async function listCadFiles(): Promise<CadFile[]> {
  const res = await http.get<{ files?: CadFile[] }>('/cad/files')
  return res.files ?? []
}

/** GET /cad/parse/{file_id} —— 解析分析（平铺结构，见文件头说明） */
export function parseCadFile(fileId: string): Promise<CadAnalysis> {
  return http.get<CadAnalysis>(`/cad/parse/${encodeURIComponent(fileId)}`)
}

/** GET /cad/text/{file_id} —— 提取 TEXT/MTEXT 文字实体 */
export function cadTexts(fileId: string): Promise<CadTextResult> {
  return http.get<CadTextResult>(`/cad/text/${encodeURIComponent(fileId)}`)
}

/** DELETE /cad/files/{file_id} —— 删除上传文件 */
export function deleteCadFile(fileId: string): Promise<{ success: boolean; message: string }> {
  return http.delete<{ success: boolean; message: string }>(`/cad/files/${encodeURIComponent(fileId)}`)
}

/** GET /cad/export/json/{file_id}?download=true —— 导出 JSON（二进制下载，走原生 fetch） */
export async function exportCadJson(fileId: string): Promise<void> {
  const resp = await fetch(
    `${API_BASE}/cad/export/json/${encodeURIComponent(fileId)}?download=true`,
    { headers: authHeaders() },
  )
  if (!resp.ok) throw new Error(`导出失败 (${resp.status})`)
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileId}.json`
  a.click()
  URL.revokeObjectURL(url)
}
