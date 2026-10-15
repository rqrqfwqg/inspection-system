/**
 * 数据表管理 —— 首页第四块的接口封装。
 *
 * 数据源复用资产侧既有端点（已在生产验证）：
 *   GET /assets/tables              表清单（含 record_count / field_count）
 *   GET /assets/tables/{tid}/records 某表记录（裸数组）
 *
 * 本模块只做「首页入口 + 列表 + 进表看数据」所需的最小封装，不新增后端依赖。
 */
import { assetDataTables, assetTableRecords } from '@/api/asset'
import type { AssetDataTable, AssetTableRecord } from '@/types/asset'

export type { AssetDataTable, AssetTableRecord }

/** 已配置的数据表（只取启用），首页列表直接用 */
export function listDataTables(): Promise<AssetDataTable[]> {
  return assetDataTables()
}

/** 某张表的记录，limit 缺省拉全部（后端裸数组，无分页壳） */
export function listTableRecords(
  tid: number,
  params: { limit?: number; skip?: number; q?: string } = {},
): Promise<AssetTableRecord[]> {
  return assetTableRecords(tid, params)
}

/**
 * 记录里可展示的字段：优先取 data 里的键值对，忽略空值。
 * 🔴 `seq`（序号）不是数据属性，是纯展示字段（2026-10-14 用户明确，所有表一致）：
 *    行号由列表页按位置自动生成，这里剔除，避免与展示序号重复。
 */
export function recordFields(rec: AssetTableRecord): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = []
  const d = rec.data || {}
  for (const k of Object.keys(d)) {
    if (k === 'seq') continue
    const v = d[k]
    if (v === null || v === undefined || v === '') continue
    out.push({ label: k, value: String(v) })
  }
  return out
}