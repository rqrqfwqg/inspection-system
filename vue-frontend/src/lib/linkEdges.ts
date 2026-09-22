/**
 * 关联边显示口径 · 隐藏「回路标注明细」的关联边
 * =====================================================================
 * 背景（2026-09-22 用户要求：关联图谱不需要显示电气配电（图纸提取）的回路标注）
 *   图纸解析把平面图上的**回路号文字标注**逐个抓成了记录，落在「电气配电（图纸提取）」
 *   子系统的《回路标注明细》表（`elec_circuit_label`，1855 条，编号形如 `LBL-TC1F-0022`）；
 *   规则引擎又为它们建了 `label_cabinet` 关联边（265 条）。它们不是实体对象，只是图上
 *   抄下来的文字，出现在「关联图谱」与「关联关系」列表里就是噪声
 *   （实测：电柜 `G-1D6AL` 的 8 条关联里 4 条是它）。
 *
 * 判定（两条取「或」，任一侧改名都兜得住）
 *   a) `rule === 'label_cabinet'` —— 建边规则本身；
 *   b) 对端编号以 `LBL-` 开头 —— 该表 device_code 的唯一前缀。
 *   线上校验：1855 条 `LBL-*` 全部且仅属该表；265 条 `label_cabinet` 边 from 端
 *   100% 是 `LBL-*`、to 端 0 条 —— 两个条件在本库完全等价。
 *
 * 边界：**只做显示收敛，不删数据、不改后端**
 *   · 供电链不受影响：`上级配电` 等 power/cooling 边原样保留；
 *   · `/search` 的供电链 BFS 只沿 power/cooling 走，天然不含这些「关联」边，
 *     所以图谱退回 `/search` 边时也不会把它们放回来。
 *
 * 本文件只放**无副作用纯函数**（与 `lib/format.ts` 同口径）。
 */
import type { DeviceLinkEdge, DeviceLinkResponse } from '@/types/viz-device-link'

/** 建立这些边的规则 id（后端 `_rel_source` 透出的 `meta.rule`） */
const CIRCUIT_LABEL_RULE = 'label_cabinet'
/** 《回路标注明细》记录编号的唯一前缀 */
const CIRCUIT_LABEL_PREFIX = 'LBL-'

/** 该边是否属于「回路标注明细」（图纸文字标注图元）——应隐藏 */
export function isCircuitLabelEdge(e: DeviceLinkEdge): boolean {
  if (e.rule === CIRCUIT_LABEL_RULE) return true
  return String(e.other_code ?? '').startsWith(CIRCUIT_LABEL_PREFIX)
}

/**
 * 过滤掉「回路标注明细」的关联边，并**同步重算 `edge_summary`**
 * （否则「共 N 条」会与实际显示条数对不上）。
 *
 * 无命中时**原对象返回**，避免无谓的引用失效触发下游重渲染。
 */
export function stripCircuitLabelEdges(
  lk: DeviceLinkResponse | null,
): DeviceLinkResponse | null {
  if (!lk) return lk
  const edges = lk.edges.filter((e) => !isCircuitLabelEdge(e))
  if (edges.length === lk.edges.length) return lk
  const edges_auto = lk.edges_auto.filter((e) => !isCircuitLabelEdge(e))
  const edges_manual = lk.edges_manual.filter((e) => !isCircuitLabelEdge(e))
  const by_type: Record<string, number> = {}
  for (const e of edges) by_type[e.relation_type] = (by_type[e.relation_type] ?? 0) + 1
  return {
    ...lk,
    edges,
    edges_auto,
    edges_manual,
    edge_summary: {
      total: edges.length,
      auto: edges_auto.length,
      manual: edges_manual.length,
      by_type,
    },
  }
}
