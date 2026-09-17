/**
 * 资料配置（/asset/settings）数据源
 * =====================================================================
 * 页面只编排：子系统字典、全局联动画像、设备关联边、设备下拉在此加载；
 * 三张 Tab 各自持有自己的局部状态（资料表 / 字段），避免一个巨型 state 在视图与组件间来回穿透。
 *
 * 纪律：
 *  1. 子系统下拉与 SubsystemManager 同源（`@/api/dict#listSubsystems`），不重复实现；
 *  2. 联动画像（/assets/link/overview）是「真实库」的唯一口径来源，与本页 KPI 条、
 *     覆盖率条、自动/人工来源构成同源；失败即报错并可重试（不静默给 0）；
 *  3. 关联边 / 设备下拉失败静默降级为空数组：它们只影响「关联管理」Tab，不阻断其余 Tab；
 *  4. 竞态：每个数据源独立序号，过期响应一律丢弃。
 */
import { ref, type Ref } from 'vue'
import { listSubsystems, type Subsystem } from '@/api/dict'
import { getLinkOverview } from '@/api/assetViz'
import assetApi from '@/api/assetApi'
import type { Device, DeviceRelation } from '@/types/asset'
import type { LinkOverview } from '@/types/assetViz'

export interface AssetSettingsState {
  subsystems: Ref<Subsystem[]>
  overview: Ref<LinkOverview | null>
  relations: Ref<DeviceRelation[]>
  devices: Ref<Device[]>
  loadingOverview: Ref<boolean>
  overviewError: Ref<string>
  loadSubsystems: () => Promise<void>
  loadOverview: () => Promise<void>
  reloadRelations: () => Promise<void>
  reloadDevices: () => Promise<void>
  reloadAll: () => Promise<void>
}

export function useAssetSettings(): AssetSettingsState {
  const subsystems = ref<Subsystem[]>([])
  const overview = ref<LinkOverview | null>(null)
  const relations = ref<DeviceRelation[]>([])
  const devices = ref<Device[]>([])
  const loadingOverview = ref(false)
  const overviewError = ref('')

  let subsystemSeq = 0

  async function loadSubsystems() {
    const mine = ++subsystemSeq
    try {
      const list = await listSubsystems()
      if (mine === subsystemSeq) subsystems.value = list
    } catch {
      // 字典失败不阻断页面：子系统下拉为空，其余 Tab 仍可用
      if (mine === subsystemSeq) subsystems.value = []
    }
  }

  let overviewSeq = 0

  async function loadOverview() {
    const mine = ++overviewSeq
    loadingOverview.value = true
    overviewError.value = ''
    try {
      const data = await getLinkOverview()
      if (mine === overviewSeq) overview.value = data
    } catch (e) {
      if (mine === overviewSeq) overviewError.value = e instanceof Error ? e.message : '加载联动画像失败'
    } finally {
      if (mine === overviewSeq) loadingOverview.value = false
    }
  }

  let relationSeq = 0

  async function reloadRelations() {
    const mine = ++relationSeq
    try {
      const list = await assetApi.listRelations()
      if (mine === relationSeq) relations.value = list
    } catch {
      if (mine === relationSeq) relations.value = []
    }
  }

  let deviceSeq = 0

  async function reloadDevices() {
    const mine = ++deviceSeq
    try {
      const list = await assetApi.listDevices()
      if (mine === deviceSeq) devices.value = list
    } catch {
      if (mine === deviceSeq) devices.value = []
    }
  }

  async function reloadAll() {
    await Promise.all([loadSubsystems(), loadOverview(), reloadRelations(), reloadDevices()])
  }

  return {
    subsystems,
    overview,
    relations,
    devices,
    loadingOverview,
    overviewError,
    loadSubsystems,
    loadOverview,
    reloadRelations,
    reloadDevices,
    reloadAll,
  }
}
