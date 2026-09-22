/**
 * 资料表「破坏性操作」统一护栏（唯一删除入口 = 「数据表管理」概览卡）
 * =====================================================================
 * 背景：资料表彻底删除是**级联硬删**（后端删除该表 + 全部 field_defs + 全部 records，不可恢复）。
 * 2026-09-22 入口收口：删除**只保留「数据表管理」概览卡**（护栏完备 + 能看到已停用表）；
 * 「资料配置 → 资料表与字段」已不再提供删除。护栏收敛到此单点，避免从松的一侧误删。
 *
 * 纪律：
 *  - **仅已停用的表可删**（`is_active === false`）：调用方必须在进入本函数前拦住活跃表
 *    （模板层禁用 + 处理函数内 `is_active !== false → return` 双保险）；本函数自身不判活跃态；
 *  - 必须手动输入该表 code 才能提交（`inputValidator` 严格相等，不等于即拒绝）；
 *  - 文案必须含：表名、code、记录数、字段数，以及「删除后不可恢复 + 会减少资产总台账计数」；
 *  - 动态值（表名 / code）经 HTML 转义后再拼入，避免 dangerouslyUseHTMLString 注入。
 */
import { ElMessageBox } from 'element-plus'
import type { DataTable } from '@/types/asset'

/** 最小 HTML 转义（仅用于 el-message-box 的 HTML 文案，防注入） */
function esc(raw: string): string {
  return raw.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}

/**
 * 弹出「彻底删除资料表」确认框。
 * @returns 用户确认（且输入 code 正确）→ true；取消 / 输入不符 → false。
 */
export async function confirmDeleteTable(table: DataTable): Promise<boolean> {
  const records = table.record_count ?? 0
  const fields = table.field_count ?? 0
  const name = esc(table.name)
  const code = esc(table.code)
  try {
    await ElMessageBox.prompt(
      `将彻底删除资料表「<b>${name}</b>」（<b>${code}</b>），` +
        `包含 <b>${records}</b> 条记录、<b>${fields}</b> 个字段。<br/>` +
        `删除后该表及其记录<b>不再可查</b>，且<b>会减少资产总台账的设备/记录数</b>，<b>不可恢复</b>。<br/>` +
        `请输入该表的 code「<b>${code}</b>」以确认：`,
      '彻底删除资料表（不可恢复）',
      {
        type: 'error',
        confirmButtonText: '彻底删除',
        cancelButtonText: '取消',
        dangerouslyUseHTMLString: true,
        inputPlaceholder: '请输入该表 code',
        // 严格相等：输入不符则内联报错并阻止提交（对话框不关闭）
        inputValidator: (value: string) => (value === table.code ? true : `输入不一致，请准确输入：${table.code}`),
      },
    )
    return true
  } catch {
    // 取消 / 关闭 → 视为放弃
    return false
  }
}
