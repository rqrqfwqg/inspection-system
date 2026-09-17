/**
 * 资产可视化 · 单对象三元数据源（设备属性页右栏 / 设备详情抽屉共用）
 * =====================================================================
 * 为什么必须收敛：两个视图都要「/search 聚合 + /link/device 联动 + /ba/problems 问题」
 * 三源并取，任一源不可用都不该拖垮整屏；React 版在两处各写了一遍（且 Drawer 那份还要
 * 顺带取现场定位）。收敛成 composable 后，三件事只有一份实现：
 *  1. **并发竞态**：抽屉里连续点不同编号时，先发的慢响应不得覆盖后发的（自增序号）；
 *  2. **降级口径**：三个源各自 catch 成空值，不因某个端点 5xx 而整屏空白；
 *  3. **卸载/切换后不再写状态**（编号变化即作废上一轮）。
 *
 * 契约权威：SearchResult 一律用 `@/types/assetViz`（复用 `@/types/asset` 的真源），
 * 而非 `@/types/search` 的子集形状 —— 画像 profile / 固资 / 档案 / 配件 / 别名只在前者上。
 */
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import { searchDevice } from '@/api/search'
import { getBaProblems, getDeviceLink, getGeoObservations } from '@/api/assetViz'
import type { BaProblem, DeviceLinkResponse, GeoObservation, SearchResult } from '@/types/assetViz'

export interface VizDeviceBundle {
  loading: Ref<boolean>
  /** 三条源总体失败时才非空（单源失败各自的空值降级不报错） */
  error: Ref<string>
  search: ShallowRef<SearchResult | null>
  link: ShallowRef<DeviceLinkResponse | null>
  problems: Ref<BaProblem[]>
  geo: Ref<GeoObservation[]>
  load: (code: string, withGeo?: boolean) => Promise<void>
  reset: () => void
}

export function useVizDeviceBundle(): VizDeviceBundle {
  const loading = ref(false)
  const error = ref('')
  const search = shallowRef<SearchResult | null>(null)
  const link = shallowRef<DeviceLinkResponse | null>(null)
  const problems = ref<BaProblem[]>([])
  const geo = ref<GeoObservation[]>([])
  let seq = 0

  function reset() {
    seq += 1
    loading.value = false
    error.value = ''
    search.value = null
    link.value = null
    problems.value = []
    geo.value = []
  }

  async function load(code: string, withGeo = false) {
    const target = code.trim()
    if (!target) {
      reset()
      return
    }
    const mine = ++seq
    loading.value = true
    error.value = ''
    search.value = null
    link.value = null
    problems.value = []
    geo.value = []

    const [s, ba, lk, g] = await Promise.all([
      searchDevice(target)
        .then((r) => r as SearchResult)
        .catch(() => null),
      getBaProblems({ device_code: target, page_size: 100 }).catch(
        () => ({ items: [] as BaProblem[], total: 0, summary: {} as BaProblemsSummary }),
      ),
      getDeviceLink(target).catch(() => null),
      withGeo ? getGeoObservations(target, 20) : Promise.resolve([] as GeoObservation[]),
    ])

    if (mine !== seq) return
    search.value = s
    link.value = lk
    problems.value = ba.items ?? []
    geo.value = g
    // 三源全空 = 该编号既不在设备域也不在资料域；不是错误，交给视图渲染空态
    loading.value = false
  }

  return { loading, error, search, link, problems, geo, load, reset }
}

/** getBaProblems 的兜底返回值形状（只用于 catch 分支，避免在业务代码里写内联断言） */
type BaProblemsSummary = Record<string, unknown>
