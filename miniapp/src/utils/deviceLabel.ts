/**
 * deviceLabel — 现场扫码核对用的设备标签工具。
 *
 * ⚠️ 抽取规则与后端 `inspection-system/backend/asset_code_match.py` 的
 *    `extract_serial_from_brand` **逐条镜像**（v2 规则）。后端是权威侧（匹配在它那里发生），
 *    前端仅作离线本地高亮；两版必须一致，否则核对卡高亮值会与后端命中对不上。
 *    等价性由 `tests/extractEquivalence.mjs` 对同一份语料逐字节比对保证。
 *
 * v2 规则（对应后端 §1.3）：
 *   1. `\r\n` → 空格并 trim；
 *   2. `SPLIT`（含 "/"）切段；
 *   3. 每段用 `CODE_TAIL` 取**不含 CJK 的连续代码**——紧贴中文的前缀自动剥离
 *      （`配电箱G-B1AD1EPSa1` → `G-B1AD1EPSa1`）；
 *   4. 候选须「含数字 且（含字母 或 含连字符）」且不落在 `UNIT_TAIL` 单位黑名单；
 *   5. 取最长段，同长取更靠后者；无候选 / 最长段 >40 字符 → 空串。
 *
 * 实测样例：
 *   「白云电器，配电箱 G-1D9APt」                 → 机身编号 G-1D9APt
 *   「西默电气，配电箱G-B1AD1EPSa1」              → 机身编号 G-B1AD1EPSa1
 *   「成套配电箱ALE2B21/大航有能电气有限公司」     → 机身编号 ALE2B21
 *   「母线槽插接箱/MCCB-250F140/3PMX/施耐德」      → 机身编号 MCCB-250F140
 *   「24口接入层交换机（堆叠,POE）中兴 ZXR10 5950-36PM-E」 → 机身编号 5950-36PM-E
 *   「室内枪式IP摄像机 宇视IPC-L2A4-FW」          → 机身编号 IPC-L2A4-FW
 *   「配电箱 6kW弱电间 白云电器」                  → 无（6kW 被单位后缀黑名单拦下）
 *   「0512001」                                   → 无（纯数字分类码）
 *   「GTC 配电箱 J1」                              → 机身编号 J1（2 字符亦合法，v1 会漏）
 */

/** 一段连续的「代码样式」字符（首字符为 ASCII 字母/数字，其余含 . _ -） */
const CODE_TAIL = /[A-Za-z0-9][A-Za-z0-9._-]*/g
/** 切分集合（含 "/"）——与后端 SPLIT 一致 */
const SPLIT = /[\s，,、；;：:（）()/]+/
/** 单位后缀黑名单：防「6kW / 250V / 380A」这类额定值被当成编号 */
const UNIT_TAIL = /^\d+(\.\d+)?(k?W|k?V|kVA|m?A|Hz|V|A|W|mm?|℃)$/i
/** 机身编号长度上限（超过即判为不是编号） */
const MAX_SERIAL_LEN = 40

/**
 * 从 brand_model 文本中抽取设备**机身编号**（抽不到返回空串）。
 * 规则与后端 `extract_serial_from_brand` 完全一致，结果保证**不含 CJK**。
 */
export function extractSerialNo(brandModel?: string | null): string {
  const text = String(brandModel || '').replace(/[\r\n]+/g, ' ').trim()
  if (!text) return ''

  // 逐段用 CODE_TAIL 取「不含 CJK 的连续代码」——等价 Python 的 CODE_TAIL.finditer
  const segs: string[] = []
  for (const tok of text.split(SPLIT)) {
    CODE_TAIL.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CODE_TAIL.exec(tok)) !== null) {
      segs.push(m[0])
      if (m.index === CODE_TAIL.lastIndex) CODE_TAIL.lastIndex++ // 防御零宽匹配
    }
  }

  // 候选：含数字 且（含字母 或 含连字符），且不在单位黑名单
  const cands = segs.filter(
    (s) => /\d/.test(s) && (/[A-Za-z]/.test(s) || s.includes('-')) && !UNIT_TAIL.test(s),
  )
  if (!cands.length) return ''

  // 取最长段；同长取更靠后者（铭牌编号常在末尾）——等价 max(key=(len, segs.index))
  let best = ''
  let bestKey: [number, number] = [-1, -1]
  for (const s of cands) {
    const key: [number, number] = [s.length, segs.indexOf(s)]
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = s
      bestKey = key
    }
  }
  return best.length <= MAX_SERIAL_LEN ? best : ''
}

/**
 * brand_model → 展示两行：机身编号（可为空）与「其余部分」品牌/名称。
 * 抽不到时返回 `{ serial: '', rest: 原文 }`（行为不变）。目前页面只用 extractSerialNo。
 */
export function splitBrandModel(brandModel?: string | null): { serial: string; rest: string } {
  const raw = String(brandModel || '').replace(/[\r\n]+/g, ' ').trim()
  const serial = extractSerialNo(raw)
  if (!serial) return { serial: '', rest: raw }
  const rest = raw.split(serial).join(' ').replace(/[\s，,、；;：:]+/g, ' ').trim()
  return { serial, rest }
}

/**
 * 「7 位纯数字」判据 —— 这类 asset_code 是**固定资产分类码**，不是单台设备的唯一号。
 *
 * ## 为什么必须过滤（2026-09-30 查线上库得出）
 * `fixed_assets.asset_code` 一列混了**两种语义**：
 *
 * | 形态 | 码数 | 挂设备数 | 平均 | 语义 |
 * |---|---|---|---|---|
 * | **7 位纯数字**（如 `0603001`） | 68 | 5775 | **84.9 台/码** | 固定资产分类码 |
 * | 其他（13/14/12/18 位带字母连字符） | 1144 | 1201 | **1.05 台/码** | 单台设备唯一号 |
 *
 * 典型反例：`0306002`（视频监控设备）挂 **2003 台**、`0603001`（配电箱）挂 **1037 台**。
 * 若把分类码打上标签，同型号设备会同号 → 标签**毫无区分度**（用户已明确否决）。
 * 正确做法：只打唯一号，分类码整行省略。
 */
const ASSET_CLASS_CODE = /^\d{7}$/

/**
 * 提取可打标签的**固定资产唯一号**（分类码与空值返回空串）。
 *
 * 实测覆盖率：1201 / 7237 = **16.6%**（唯一号本身录入不全，非本函数问题）。
 */
export function extractAssetNo(assetCode?: string | null): string {
  const v = String(assetCode || '').trim()
  if (!v) return ''
  if (ASSET_CLASS_CODE.test(v)) return '' // 7 位纯数字 = 分类码，丢弃
  return v
}

