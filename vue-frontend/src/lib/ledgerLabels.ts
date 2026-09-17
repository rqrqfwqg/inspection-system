/**
 * 资料域展示常量（数据表管理 / 资料配置 / 记录编辑共用）
 * =====================================================================
 * 为什么收敛成一份：字段类型中文名、子系统图标候选、字段映射置信度文案在
 * FieldManager / RecordEditDialog / RecordTransferDialog / 资料配置页四处都要用，
 * 各写一份必然漂移（React 版即为此：TYPE_LABELS 与 CONF_STYLE 分散在两个文件里）。
 *
 * 本文件只放无副作用的常量与纯函数。**不出现任何字面色值**：
 * 颜色由调用方走设计令牌（CSS 变量），这里只给语义档位（tone）。
 */
import type { FieldType } from '@/types/asset'

/** 字段类型 → 中文名 */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '文本',
  number: '数字',
  date: '日期',
  select: '单选',
  device_ref: '设备引用',
}

/** 字段类型可选值（顺序即下拉顺序） */
export const FIELD_TYPE_OPTIONS: FieldType[] = ['text', 'number', 'date', 'select', 'device_ref']

/**
 * `subsystems.icon` 的候选值。
 * DB 里存的是 **lucide 名**（后端 / 数据红线不可改，见 SPEC §11「图标库混用」），
 * 前端本轮不做图标渲染映射（登记于 SPEC §14 D-03），此处仅提供枚举以避免自由输入造出无法映射的值。
 */
export const SUBSYSTEM_ICON_OPTIONS: string[] = [
  'Zap', 'Flame', 'Cable', 'Snowflake', 'Lightbulb', 'Droplets', 'Fan', 'Cpu', 'Wrench', 'Database',
]

/** 字段映射置信度 → el-tag 语义档位（颜色由 EP 变量继承 tokens，此处不写色值） */
export type TransferConfidenceTone = 'success' | 'primary' | 'warning' | 'info'

const TRANSFER_CONFIDENCE: Record<string, { text: string; tone: TransferConfidenceTone }> = {
  exact_key: { text: '字段同名', tone: 'success' },
  exact_label: { text: '名称相同', tone: 'success' },
  normalized: { text: '名称归一', tone: 'primary' },
  relation_key: { text: '关联键', tone: 'primary' },
  contains: { text: '名称包含', tone: 'warning' },
  type_only: { text: '同类型', tone: 'warning' },
  none: { text: '未匹配', tone: 'info' },
}

/** 未知置信度一律回落「未匹配」，不白屏、不裸抛 */
export function transferConfidence(confidence: string): { text: string; tone: TransferConfidenceTone } {
  return TRANSFER_CONFIDENCE[confidence] ?? TRANSFER_CONFIDENCE.none
}

/**
 * 关联边来源判定：**只有** `meta.source === 'auto'` 才算自动，
 * 其余（含无 meta 标记的历史边）一律按人工归类 —— 与后端 `unmarked_legacy` 口径一致。
 */
export function relationSourceOf(meta: unknown): 'auto' | 'manual' {
  if (!meta || typeof meta !== 'object') return 'manual'
  return (meta as Record<string, unknown>).source === 'auto' ? 'auto' : 'manual'
}

/** 从 meta 里安全取字符串（rule / evidence 等审计字段，缺失返回空串） */
export function metaText(meta: unknown, key: string): string {
  if (!meta || typeof meta !== 'object') return ''
  const value = (meta as Record<string, unknown>)[key]
  return value === null || value === undefined ? '' : String(value)
}
