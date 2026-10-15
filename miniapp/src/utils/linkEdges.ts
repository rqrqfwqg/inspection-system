/**
 * linkEdges — 「回路标注明细」显示收敛（小程序侧）
 *
 * 与 Web 端 `vue-frontend/src/lib/linkEdges.ts` 同源同口径：
 * Web 端 2026-09-22 上线该过滤，小程序侧一直没同步，导致「小程序与网页看到的
 * 关联数据不一样」（网页已隐藏、小程序仍显示）。本模块用于消除这个差异。
 *
 * 背景：图纸解析把平面图上的回路号文字标注逐条抓成记录，落在子系统
 * `elec_dwg`「电气配电（图纸提取）」的《回路标注明细》表（elec_circuit_label，
 * 编号 LBL-TC1F-xxxx，1855 条），规则引擎又为它们建了 label_cabinet 关联边
 * （265 条）。它们不是实体对象，只是图上抄下来的文字，在关联展示里是噪声。
 *
 * 线上实测（2026-10-14）：/assets/relations 与 /assets/link/device 两个接口
 * 都按原样暴露这些边（电柜 G-1D6AL 各 8 条里 4 条是 LBL-*）。
 * 故在**前端数据层**收敛，不删数据、不改后端接口。
 *
 * 判定取「或」，任一侧改名都兜得住：
 *   1) rule === 'label_cabinet'（link 边的顶层字段 / relations 的 meta.rule）
 *   2) 任一端编号以 'LBL-' 开头（from_code / to_code / other_code）
 */

/** 关联边（/assets/relations 的 DeviceRelationItem：rule 在 meta 里） */
export interface CircuitLabelRelationLike {
  from_code?: string
  to_code?: string
  meta?: Record<string, unknown> | null
}

/** 联动边（/assets/link/device 的 AssetDeviceLinkEdge：rule 是顶层字段） */
export interface CircuitLabelEdgeLike {
  from_code?: string
  to_code?: string
  other_code?: string
  rule?: string | null
  meta?: Record<string, unknown> | null
}

const LBL_PREFIX = 'LBL-'
const LABEL_RULE = 'label_cabinet'

/** 取 rule：link 边取顶层 rule，relations 取 meta.rule */
function ruleOf(x: CircuitLabelRelationLike | CircuitLabelEdgeLike): string | undefined {
  const top = (x as CircuitLabelEdgeLike).rule
  if (typeof top === 'string' && top) return top
  const meta = x.meta
  if (meta && typeof meta === 'object') {
    const r = (meta as { rule?: unknown }).rule
    if (typeof r === 'string' && r) return r
  }
  return undefined
}

function isLblCode(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(LBL_PREFIX)
}

/** /assets/relations 的一条边是否是「回路标注明细」 */
export function isCircuitLabelRelation(r: CircuitLabelRelationLike): boolean {
  if (!r) return false
  if (ruleOf(r) === LABEL_RULE) return true
  return isLblCode(r.from_code) || isLblCode(r.to_code)
}

/** /assets/link/device 的一条边是否是「回路标注明细」 */
export function isCircuitLabelEdge(e: CircuitLabelEdgeLike): boolean {
  if (!e) return false
  if (ruleOf(e) === LABEL_RULE) return true
  if (isLblCode(e.other_code)) return true
  // other_code 缺失时兜底看两端（LBL- 前缀只属于该表，不会误伤真实设备）
  return isLblCode(e.from_code) || isLblCode(e.to_code)
}

/** 过滤关联边（/assets/relations） */
export function stripCircuitLabelRelations<T extends CircuitLabelRelationLike>(list: T[]): T[] {
  if (!Array.isArray(list) || !list.length) return list || []
  return list.filter((r) => !isCircuitLabelRelation(r))
}

/** 过滤联动边（/assets/link/device） */
export function stripCircuitLabelEdges<T extends CircuitLabelEdgeLike>(list: T[]): T[] {
  if (!Array.isArray(list) || !list.length) return list || []
  return list.filter((e) => !isCircuitLabelEdge(e))
}
