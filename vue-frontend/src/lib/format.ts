/**
 * 展示口径与格式化（**全站唯一实现**）
 * =====================================================================
 * 为什么单独成文件：金额/日期/空值的口径若复制进各组件，汇总卡与表格会出现
 * 「同一金额两个值」的静默不一致。所有页面一律 import 本模块。
 *
 * 铁律（与后端排序口径一致）：
 *  1. 空值恒呈现为「—」，且**不参与**任何算术或排序；
 *  2. 金额一律两位小数 + 千分位；量级压缩只在汇总卡使用；
 *  3. 时间戳口径：后端 `created_at` / `observed_at` 落库是 **UTC**，
 *     展示北京时间必须 +8（`fmtBeijingUtc`）——直接 `new Date(s)` 会偏早 8 小时；
 *  4. `accuracy` 缺失**不能补 0**（±0m 会被误读成「极其精准」）。
 *
 * 本文件只放**无副作用纯函数**，不 import 任何 store / api / 组件。
 */

/* ============================ 值判定 ============================ */

export function hasDisplayValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  return true
}

/** 判定是否「不可省略」的编号类字段（走等宽 + 强制断行，禁止省略号） */
export function isCodeLike(key: string): boolean {
  return /code|tag|_no$/i.test(key)
}

/* ============================ 通用格式化 ============================ */

export function fmtInt(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v.toLocaleString('zh-CN')
}

/** 金额：两位小数、千分位（表格与汇总卡同源，避免口径漂移） */
export function fmtMoney(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 汇总卡用的量级压缩（万 / 亿） */
export function fmtMoneyBig(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return '¥0'
  if (v >= 1e8) return `¥${(v / 1e8).toFixed(2)} 亿`
  if (v >= 1e4) return `¥${(v / 1e4).toFixed(2)} 万`
  return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

/** 日期截断到 YYYY-MM-DD（后端给的是 ISO 串，不做时区换算） */
export function fmtDate(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  return s ? s.slice(0, 10) : '—'
}

/** 通用取值格式化（未知列不猜语义，只做安全呈现） */
export function fmtValue(v: unknown): string {
  if (!hasDisplayValue(v)) return '—'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('zh-CN') : String(v)
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (Array.isArray(v)) return v.map((x) => fmtValue(x)).join('、')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** 百分比（0..1 → 12.3%）；入参为 null/NaN 时给「—」 */
export function fmtPercent(v: number | null | undefined, digits = 1): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return (v * 100).toFixed(digits) + '%'
}

/* ============================ 时间（UTC → 北京时间） ============================ */

/**
 * UTC 串 → 北京时间 `YYYY-MM-DD HH:mm`。
 * 后端 `created_at` / `observed_at` 落库均为 UTC，服务器时区虽是 CST 但值不变，
 * 因此**必须显式 +8**；跨日会正确进位（用时间戳而非字符串拼接）。
 */
export function fmtBeijingUtc(v: string | null | undefined, withSeconds = false): string {
  const s = (v ?? '').trim()
  if (!s) return '—'
  const iso = s.includes('T') ? s : s.replace(' ', 'T')
  const t = Date.parse(iso.endsWith('Z') ? iso : iso + 'Z')
  if (!Number.isFinite(t)) return s
  const d = new Date(t + 8 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const base =
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  return withSeconds ? `${base}:${p(d.getUTCSeconds())}` : base
}

/* ============================ 现场定位 ============================ */

/** 坐标保留 6 位（约 0.1m 精度，足够定位到机柜） */
export function fmtCoord(v: number | string | null | undefined): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(6) : '—'
}

/** 定位精度：缺失写「精度未知」，**绝不补 ±0m** */
export function fmtAcc(v: number | string | null | undefined): string {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '精度未知'
  return `±${Math.round(n)}m`
}

/** 精度分档（用于徽标着色）：≤50m 精确 / >50m 粗略 / 未知 */
export function accToneOf(v: number | string | null | undefined): 'exact' | 'coarse' | 'unknown' {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return 'unknown'
  return n <= 50 ? 'exact' : 'coarse'
}

/** 两点球面距离（米）——用于「较上次偏移」提示 */
export function driftMeters(
  aLat: number | string | null | undefined,
  aLng: number | string | null | undefined,
  bLat: number | string | null | undefined,
  bLng: number | string | null | undefined,
): number | null {
  const [a1, o1, a2, o2] = [Number(aLat), Number(aLng), Number(bLat), Number(bLng)]
  if (![a1, o1, a2, o2].every((n) => Number.isFinite(n))) return null
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(a2 - a1)
  const dLng = rad(o2 - o1)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 与小程序保持同值：小于该距离视为同一位置，不计入偏移 */
export const GEO_NOISE_METERS = 20

/* ============================ 字段中文名 ============================ */

/** 固定资产 / 设备主表 / 设备档案 / 资料表共用字段中文名（未命中回落原始 key） */
const FIELD_LABELS: Record<string, string> = {
  device_code: '设备编号', asset_name: '资产名称', asset_code: '资产代码', name: '设备名称',
  transfer_no: '移交编号', tag_no: '标签号', owner_unit: '权属单位', use_dept: '使用单位',
  location: '所在地点', location_desc: '位置描述', brand_model: '品牌型号', serial_no: '出厂序列号',
  recv_date: '接收日期', warranty_end: '保修截止', price_tax: '含税价', price_notax: '不含税价',
  tax: '税额', budget_item: '概算项目', contract_no: '合同编号', bim_tag: 'BIM 标签',
  builder: '承建单位', responsible: '责任人', proj_manager: '项目负责人', warranty_contact: '保修联系人',
  remark: '备注', room_code: '关联机房', room_match_method: '机房匹配方式',
  subsystem_id: '子系统 ID', subsystem_name: '所属子系统', building: '楼栋', floor: '楼层',
  is_active: '在用状态', pre_no: '原编号', project: '项目', system_text: '系统（原文）',
  old_name: '原名', old_code: '原代码', manufacturer: '厂商', qty: '数量', unit: '单位',
  original_value: '原值', residual_rate: '残值率', net_value: '净值', status_name: '状态',
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

/* ============================ 台账匹配方式 ============================ */

const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: '编号精确匹配',
  alias: '编号别名匹配',
  observation_exact: '机身编码精确匹配',
  brand_extract_exact: '品牌型号提取匹配',
  serial_no_exact: '序列号精确匹配',
  brand_substring: '品牌型号模糊匹配',
  field_substring: '字段模糊匹配',
}

export function matchTypeLabel(matchType: string): string {
  return MATCH_TYPE_LABELS[matchType] ?? '台账匹配'
}

/* ============================ 保修状态 ============================ */

export type WarrantyState = 'ok' | 'soon' | 'expired' | null | undefined

export function warrantyTagType(state: WarrantyState): 'danger' | 'warning' | 'info' {
  if (state === 'expired') return 'danger'
  if (state === 'soon') return 'warning'
  return 'info'
}

export function warrantyText(state: WarrantyState): string {
  if (state === 'expired') return '已过保'
  if (state === 'soon') return '即将到期'
  return '保内'
}
