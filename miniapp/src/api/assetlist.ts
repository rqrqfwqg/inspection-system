/**
 * 资产查询（列表）—— 资产页「仅已盘点」主数据源（分页版）。
 *
 * ⚠️ 设计说明（重要，别改）：
 * 巡检表 `room_inventory_records` 是**房间级**盘点，不是设备级，所以「设备是否已盘点」
 * 的唯一可靠口径是：设备 → 所属房间 → 该房间在 room_inventory_records 里有 completed 记录。
 *
 * 实现（后端新增端点，前端零扇出）：
 *   GET /assets/inspected-devices  一次返回「已盘点」设备全集的当前页 + 总数 + 子系统计数
 *
 * 旧实现 `assetListAllInspected` 曾对每个已盘点房间各发一次 `assetRoomDevices`
 * （≈530 个并发请求），是资产页卡死/极慢的根因。新版改为：后端复用 60s 缓存的台账全集，
 * 在内存里筛出 confirmed 设备并分页，前端只发「当前页」这一两个请求。
 *
 * 翻页/筛选的口径一致性由后端保证（categories 基于「关键字过滤后、子系统过滤前」的集合），
 * 前端不再各自扫描得到不一致的子集。
 */
import { assetInspectedDevices, type InspectedDevicesResult } from '@/api/asset'

/** 列表行（字段与卡片模板对齐，沿用既有 snake_case 命名） */
export interface AssetListItem {
  device_code: string
  name: string
  asset_name: string
  /** 所属子系统名称（类别） */
  subsystem_name: string
  room_code: string
  building: string
  floor: string
  area: string
  brand_model: string
  location: string
}

/** 资产筛选条件 */
export interface AssetListQuery {
  /** 子系统名称（类别）；空 = 全部 */
  subsystemName?: string
  /** 关键字，匹配设备编号 / 名称 / 品牌型号 / 位置 */
  keyword?: string
}

/** 每页条数（前端分批渲染，避免一次渲染上千条卡顿） */
export const INSPECTED_PAGE_SIZE = 30

/** 已盘点设备分页结果（第一页附带总数与分类计数） */
export interface InspectedPage {
  items: AssetListItem[]
  total: number
  categories: Array<{ subsystem_name: string; count: number }>
}

/** 把后端单行映射成前端列表行（snake_case，与卡片模板对齐） */
function mapRow(i: InspectedDevicesResult['items'][number]): AssetListItem {
  return {
    device_code: i.device_code,
    name: i.name || i.device_name || i.device_code,
    asset_name: i.device_name,
    subsystem_name: i.subsystem_name,
    room_code: i.room_code || i.inventory_room_code,
    building: i.building,
    floor: i.floor,
    area: i.area,
    brand_model: i.brand_model,
    location: i.location,
  }
}

/**
 * 拉取「已盘点」第一页（重置分页），返回本页行 + 总数 + 子系统计数。
 * 任何筛选（类别 / 关键字）变化都走这个函数，保证从头加载且计数同步刷新。
 */
export async function fetchInspectedFirstPage(
  q: AssetListQuery,
  pageSize = INSPECTED_PAGE_SIZE,
): Promise<InspectedPage> {
  const res: InspectedDevicesResult = await assetInspectedDevices({
    page: 1,
    page_size: pageSize,
    subsystem_name: q.subsystemName || undefined,
    keyword: q.keyword || undefined,
  })
  return {
    items: (res.items || []).map(mapRow),
    total: res.total || 0,
    categories: res.categories || [],
  }
}

/** 拉取「已盘点」后续页（追加，不重置计数） */
export async function fetchInspectedPage(
  page: number,
  q: AssetListQuery,
  pageSize = INSPECTED_PAGE_SIZE,
): Promise<AssetListItem[]> {
  const res: InspectedDevicesResult = await assetInspectedDevices({
    page,
    page_size: pageSize,
    subsystem_name: q.subsystemName || undefined,
    keyword: q.keyword || undefined,
  })
  return (res.items || []).map(mapRow)
}

/**
 * 兼容旧调用：盘点提交后清缓存提示。
 * 新分页接口后端自带 60s 缓存，前端已无本地全量缓存，这里保留无副作用占位，
 * 避免 Inventory 的 invalidateAssetList 动态引用报错。
 */
export function assetListInvalidate(): void {
  // 后端 60s 缓存自动失效；前端已无本地全量缓存，无需处理。
}
