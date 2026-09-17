/**
 * 单张资料表的行级维护状态（新增 / 编辑 / 删除 / Excel 导入导出 / 跨表转移 / 跨表关联）
 * =====================================================================
 * 从 React 版 `AssetLedgerPage.tsx`（585 行）里抽出的「请求 + 状态」部分，视图只编排。
 *
 * 纪律：
 *  1. 字段与记录并发取，序号递增防止旧响应覆盖新数据；
 *  2. 行级搜索只作用于**已加载**记录（与 React 版同口径），不改后端请求参数；
 *  3. 危险操作走 `ElMessageBox` 并带对象名与影响面（UIUX §6.6），成功用 `ElMessage`（§7.2）；
 *  4. 记录数变化会置 `catalogDirty`，由视图转发为「刷新目录卡片」——避免视图直接依赖子组件细节；
 *  5. 导入 / 导出复用 `assetApi` 的 xlsx 实现（框架无关，不重写）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import assetApi from '@/api/assetApi'
import { getLinkTable } from '@/api/assetViz'
import type { FieldDef, RecordItem, TransferResult } from '@/types/asset'
import type { LinkTableDetail } from '@/types/assetViz'

export interface LedgerTable {
  fields: Ref<FieldDef[]>
  records: Ref<RecordItem[]>
  loading: Ref<boolean>
  error: Ref<string>
  rowQuery: Ref<string>
  selectedIds: Ref<number[]>
  importing: Ref<boolean>
  linkDetail: Ref<LinkTableDetail | null>
  editTarget: Ref<RecordItem | null | undefined>
  transferIds: Ref<number[] | null>
  crossRecord: Ref<RecordItem | null>
  catalogDirty: Ref<number>
  visibleRecords: ComputedRef<RecordItem[]>
  editOpen: ComputedRef<boolean>
  editInitial: ComputedRef<RecordItem | null>
  relationField: ComputedRef<FieldDef | null>
  load: () => Promise<void>
  loadLinkDetail: () => Promise<void>
  applyPendingQuery: () => void
  setPendingQuery: (value: string) => void
  setSelection: (ids: number[]) => void
  openCreate: () => void
  openEdit: (row: RecordItem) => void
  closeEdit: () => void
  onEditSaved: () => Promise<void>
  removeRecord: (row: RecordItem) => Promise<void>
  importFile: (file: File) => Promise<void>
  exportExcel: () => void
  openTransfer: (ids: number[]) => void
  closeTransfer: () => void
  onTransferred: (result: TransferResult) => Promise<void>
  openCrossRefs: (row: RecordItem) => void
  closeCrossRefs: () => void
}

export function useLedgerTable(tableId: Ref<number | null>, tableName: () => string): LedgerTable {
  const fields = ref<FieldDef[]>([])
  const records = ref<RecordItem[]>([])
  const loading = ref(false)
  const error = ref('')
  const rowQuery = ref('')
  const selectedIds = ref<number[]>([])
  const importing = ref(false)
  const linkDetail = ref<LinkTableDetail | null>(null)
  /** undefined = 弹窗关闭；null = 新增；RecordItem = 编辑 */
  const editTarget = ref<RecordItem | null | undefined>(undefined)
  const transferIds = ref<number[] | null>(null)
  const crossRecord = ref<RecordItem | null>(null)
  const catalogDirty = ref(0)

  /** 跨表跳转带过来的过滤词：等目标表记录到位后再应用（否则会被清空） */
  let pendingQuery = ''

  let loadSeq = 0

  async function load() {
    const id = tableId.value
    if (!id) {
      loadSeq += 1
      fields.value = []
      records.value = []
      error.value = ''
      loading.value = false
      return
    }
    const mine = ++loadSeq
    loading.value = true
    error.value = ''
    try {
      const [fieldList, recordList] = await Promise.all([assetApi.listFields(id), assetApi.listRecords(id)])
      if (mine !== loadSeq) return
      fields.value = fieldList
      records.value = recordList
      if (pendingQuery) {
        rowQuery.value = pendingQuery
        pendingQuery = ''
      }
    } catch (e) {
      if (mine !== loadSeq) return
      fields.value = []
      records.value = []
      error.value = e instanceof Error ? e.message : '加载记录失败'
    } finally {
      if (mine === loadSeq) loading.value = false
    }
  }

  async function loadLinkDetail() {
    const id = tableId.value
    if (!id) {
      linkDetail.value = null
      return
    }
    try {
      linkDetail.value = await getLinkTable(id)
    } catch {
      // 画像失败只影响覆盖率提示，不阻断行维护
      linkDetail.value = null
    }
  }

  function applyPendingQuery() {
    if (!pendingQuery) return
    rowQuery.value = pendingQuery
    pendingQuery = ''
  }

  function setPendingQuery(value: string) {
    pendingQuery = value
  }

  const visibleRecords = computed(() => {
    const kw = rowQuery.value.trim().toLowerCase()
    if (!kw) return records.value
    return records.value.filter((row) => {
      if ((row.device_code ?? '').toLowerCase().includes(kw)) return true
      return Object.values(row.data ?? {}).some((v) => String(v ?? '').toLowerCase().includes(kw))
    })
  })

  const relationField = computed<FieldDef | null>(
    () => fields.value.find((f) => f.is_relation_key) ?? null,
  )

  const editOpen = computed(() => editTarget.value !== undefined)
  const editInitial = computed<RecordItem | null>(() => {
    const value = editTarget.value
    return value && typeof value === 'object' ? value : null
  })

  function setSelection(ids: number[]) {
    selectedIds.value = ids
  }

  function openCreate() {
    editTarget.value = null
  }

  function openEdit(row: RecordItem) {
    editTarget.value = row
  }

  function closeEdit() {
    editTarget.value = undefined
  }

  async function onEditSaved() {
    closeEdit()
    await load()
  }

  async function removeRecord(row: RecordItem) {
    const id = tableId.value
    if (!id) return
    const label = row.device_code || `记录 #${row.id}`
    try {
      await ElMessageBox.confirm(
        `将删除资料表「${tableName() || id}」中 ${label} 这一条资料，删除后该记录不再可查。`,
        '删除记录',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    try {
      await assetApi.deleteRecord(id, row.id)
      ElMessage.success(`已删除 ${label}`)
      catalogDirty.value += 1
      await load()
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  async function importFile(file: File) {
    const id = tableId.value
    if (!id) return
    importing.value = true
    try {
      const items = await assetApi.parseExcelToRecords(file, fields.value)
      if (items.length === 0) {
        ElMessage.warning('未解析到有效数据：请检查表头是否与当前表的字段名称一致')
        return
      }
      const result = await assetApi.bulkCreateRecords(id, items)
      ElMessage.success(`导入完成：新增 ${result.created} 条，跳过 ${result.skipped} 条（缺关联键）`)
      catalogDirty.value += 1
      await load()
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      importing.value = false
    }
  }

  function exportExcel() {
    if (records.value.length === 0) {
      ElMessage.warning('暂无可导出的记录')
      return
    }
    assetApi.exportRecordsToExcel(records.value, fields.value, tableName() || '资料导出')
  }

  function openTransfer(ids: number[]) {
    if (ids.length === 0) {
      ElMessage.warning('请先勾选要转移的记录')
      return
    }
    transferIds.value = [...ids]
  }

  function closeTransfer() {
    transferIds.value = null
  }

  async function onTransferred(result: TransferResult) {
    selectedIds.value = []
    transferIds.value = null
    catalogDirty.value += 1
    ElMessage.success(
      `转移完成：新建 ${result.created} 条 · 更新 ${result.updated} 条 · 跳过 ${result.skipped} 条`,
    )
    if (result.moved > 0) ElMessage.info(`已从原表移除 ${result.moved} 条`)
    await load()
  }

  function openCrossRefs(row: RecordItem) {
    crossRecord.value = row
  }

  function closeCrossRefs() {
    crossRecord.value = null
  }

  return {
    fields, records, loading, error, rowQuery, selectedIds, importing, linkDetail,
    editTarget, transferIds, crossRecord, catalogDirty, visibleRecords,
    editOpen, editInitial, relationField,
    load, loadLinkDetail, applyPendingQuery, setPendingQuery, setSelection,
    openCreate, openEdit, closeEdit, onEditSaved, removeRecord, importFile, exportExcel,
    openTransfer, closeTransfer, onTransferred, openCrossRefs, closeCrossRefs,
  }
}
