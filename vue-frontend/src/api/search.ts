// 资料检索 API —— 只做契约与编码，不含业务编排（编排在 views/search/SearchView.vue）
//
// 参数名是坑，逐字对照 SPEC §5.2：
//   /assets/search               → code（用 q 会 422）
//   /assets/search/suggest       → q
//   /assets/link/global-search   → q
//   /assets/asset-ledger/resolve → q
//
// 编号含 #、()、空格、&、= 等特殊字符（AC-12）：这里手写 encodeURIComponent 拼查询串，
// 与 React 版 src/services/assetApi.ts:189 / 193 的写法逐字对齐。
// 注意：**不能再走 http.get 的 params 参数**——axios 的默认序列化器内部同样是
// encodeURIComponent（node_modules/axios/lib/helpers/buildURL.js:14-20），
// 两条路叠加会变成二次编码（# → %23 字面量发给后端），反而查不到。
import http from './http'
import type {
  DeviceSuggestItem,
  GlobalSearchResponse,
  LedgerResolveResponse,
  SearchBundle,
  SearchResult,
} from '@/types/search'

const BASE = '/assets'

/** 检索深度（关联跳数），后端支持 1-5，UIUX 约定默认 2 */
export const DEFAULT_DEPTH = 2
export const DEPTH_OPTIONS: number[] = [1, 2, 3, 4, 5]

/** 深度归一：非数字回落 2，越界夹到 1-5（URL 里是字符串，必须过这一层） */
export function clampDepth(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return DEFAULT_DEPTH
  return Math.min(5, Math.max(1, n))
}

function enc(v: string): string {
  return encodeURIComponent(v.trim())
}

/** GET /assets/search?code=&depth= —— 设备多维信息聚合检索（参数名 code） */
export function searchDevice(code: string, depth: number = DEFAULT_DEPTH): Promise<SearchResult> {
  return http.get<SearchResult>(`${BASE}/search?code=${enc(code)}&depth=${clampDepth(depth)}`)
}

/** GET /assets/search/suggest?q=&limit= —— 联想候选（这里的参数名才是 q） */
export function suggestDevices(keyword: string, limit = 10): Promise<DeviceSuggestItem[]> {
  return http.get<DeviceSuggestItem[]>(`${BASE}/search/suggest?q=${enc(keyword)}&limit=${limit}`)
}

/** GET /assets/link/global-search?q=&limit= —— 资料域全表模糊搜索 */
export function globalSearch(keyword: string, limit = 5): Promise<GlobalSearchResponse> {
  return http.get<GlobalSearchResponse>(`${BASE}/link/global-search?q=${enc(keyword)}&limit=${limit}`)
}

/** GET /assets/asset-ledger/resolve?q= —— 台账反查（设备域与资料域双侧命中，AC-10 主入口） */
export function resolveLedger(keyword: string): Promise<LedgerResolveResponse> {
  return http.get<LedgerResolveResponse>(`${BASE}/asset-ledger/resolve?q=${enc(keyword)}`)
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : '请求失败'
}

/**
 * 一次检索打三个域：台账反查 + 设备聚合 + 资料域全局搜索。
 * 用 allSettled 而非 all —— 任一域失败时其余域照常渲染，只有三域全空才由调用方判为错误态。
 */
export async function searchAll(
  keyword: string,
  depth: number = DEFAULT_DEPTH,
): Promise<SearchBundle> {
  const key = keyword.trim()
  const [resolve, result, global] = await Promise.allSettled([
    resolveLedger(key),
    searchDevice(key, depth),
    globalSearch(key),
  ])

  const errors: string[] = []
  if (resolve.status === 'rejected') errors.push(`台账反查：${reasonOf(resolve.reason)}`)
  if (result.status === 'rejected') errors.push(`设备聚合：${reasonOf(result.reason)}`)
  if (global.status === 'rejected') errors.push(`资料域搜索：${reasonOf(global.reason)}`)

  return {
    keyword: key,
    resolve: resolve.status === 'fulfilled' ? resolve.value : null,
    result: result.status === 'fulfilled' ? result.value : null,
    global: global.status === 'fulfilled' ? global.value : null,
    errors,
  }
}
