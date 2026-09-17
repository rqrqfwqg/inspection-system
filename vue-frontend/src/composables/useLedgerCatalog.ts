/**
 * 数据表目录（/asset/ledger 概览模式）数据源
 * =====================================================================
 * 视图只编排，加载 / 画像合并 / 竞态处理在此。
 *
 * 纪律：
 *  1. 子系统下拉只用 `@/api/dict#listSubsystems`，不重复实现（去重）；
 *  2. 联动画像（覆盖率）失败**静默降级**：画像缺失只影响覆盖率条，不得阻断「进表维护」主路径；
 *  3. 并发安全：序号递增丢弃过期响应，快速改筛选不会串数据；
 *  4. 目录与画像分别计数，互不等待（画像接口慢时不拖住目录）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { listSubsystems, type Subsystem } from '@/api/dict'
import { getLinkOverview } from '@/api/assetViz'
import assetApi from '@/api/assetApi'
import type { DataTable } from '@/types/asset'
import type { LinkOverview, LinkTableStat } from '@/types/assetViz'

export interface LedgerCatalog {
  subsystems: Ref<Subsystem[]>
  tables: Ref<DataTable[]>
  loading: Ref<boolean>
  error: Ref<string>
  overview: Ref<LinkOverview | null>
  /** table_id → 单表联动统计（覆盖率 / 关联键中文名） */
  statMap: ComputedRef<Map<number, LinkTableStat>>
  loadCatalog: () => Promise<void>
  loadOverview: () => Promise<void>
  reload: () => Promise<void>
}

export function useLedgerCatalog(): LedgerCatalog {
  const subsystems = ref<Subsystem[]>([])
  const tables = ref<DataTable[]>([])
  const loading = ref(true)
  const error = ref('')
  const overview = ref<LinkOverview | null>(null)

  let catalogSeq = 0

  async function loadCatalog() {
    const mine = ++catalogSeq
    loading.value = true
    error.value = ''
    try {
      const [list, tableList] = await Promise.all([listSubsystems(), assetApi.listTables()])
      if (mine !== catalogSeq) return
      subsystems.value = list
      tables.value = tableList
    } catch (e) {
      if (mine !== catalogSeq) return
      subsystems.value = []
      tables.value = []
      error.value = e instanceof Error ? e.message : '加载失败'
    } finally {
      if (mine === catalogSeq) loading.value = false
    }
  }

  let overviewSeq = 0

  async function loadOverview() {
    const mine = ++overviewSeq
    try {
      const data = await getLinkOverview()
      if (mine === overviewSeq) overview.value = data
    } catch {
      // 画像属辅助信息：失败即保持原值（首次失败则为 null），不写错误态、不打断目录
    }
  }

  async function reload() {
    await Promise.all([loadCatalog(), loadOverview()])
  }

  const statMap = computed(() => {
    const map = new Map<number, LinkTableStat>()
    for (const stat of overview.value?.tables ?? []) map.set(stat.table_id, stat)
    return map
  })

  return { subsystems, tables, loading, error, overview, statMap, loadCatalog, loadOverview, reload }
}
