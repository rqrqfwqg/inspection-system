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
  /** 增量加载：是否还有下一页（上页返回条数 === PAGE_SIZE 即还有；契约无 has_more/total） */
  hasMore: Ref<boolean>
  /** 增量加载：正在拉下一页（重入保护用） */
  loadingMore: Ref<boolean>
  /** 服务端搜索进行中（用 `q` 重新拉第 0 页） */
  searching: Ref<boolean>
  /** 当前展示的页集是用哪个关键字（服务端 `q`）拉回来的；`loadMore` 必须沿用它翻页 */
  queryKw: Ref<string>
  /** 当前已加载记录数（= records.length；分页下非全表总数，契约不给 total） */
  loadedCount: ComputedRef<number>
  visibleRecords: ComputedRef<RecordItem[]>
  editOpen: ComputedRef<boolean>
  editInitial: ComputedRef<RecordItem | null>
  relationField: ComputedRef<FieldDef | null>
  /** 载入第一页（切表 / 增删改后调用；保留当前关键字） */
  load: () => Promise<void>
  /** 追加下一页（重入保护：loadingMore/searching 为真或没有更多时直接 return） */
  loadMore: () => Promise<void>
  /** 用 rowQuery 当前关键字走服务端 `q` 重拉第 0 页（与 queryKw 相同则跳过） */
  runSearch: () => Promise<void>
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
  exportExcel: () => Promise<void>
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

  /** 分页大小（服务端上限 500；50 是与后端约定的首屏页大小） */
  const PAGE_SIZE = 50
  /** 是否还有下一页（上页返回条数 === PAGE_SIZE 即还有） */
  const hasMore = ref(false)
  /** 正在拉下一页（重入保护） */
  const loadingMore = ref(false)
  /** 服务端搜索进行中（用 `q` 重拉第 0 页） */
  const searching = ref(false)
  /**
   * 当前展示的页集是用哪个关键字（服务端 `q`）拉回来的。
   * `loadMore` 必须沿用它翻页 —— 不能用 `rowQuery` 实时值：请求在途时用户可能改了关键字，
   * 那样第 2 页会来自另一个结果集，列表被静默拼成混合数据。
   */
  const queryKw = ref('')

  /** 跨表跳转带过来的过滤词：等目标表记录到位后再应用（否则会被清空） */
  let pendingQuery = ''

  /**
   * 请求世代号（竞态保护，照 `useLedgerCatalog.catalogSeq` 的既定套路）：
   * 每次 `load()`（含切表 / 增删改后重载）自增；异步响应回来时对不上就**整段丢弃**，
   * 保证快速切表时旧响应绝不会追加/覆盖到新表的列表里。
   */
  let loadSeq = 0

  const loadedCount = computed(() => records.value.length)

  /** 载入第一页：切表 / 增删改后调用；**沿用当前关键字**（增删改后仍保持搜索态，与改造前一致） */
  async function load() {
    const id = tableId.value
    if (!id) {
      loadSeq += 1
      fields.value = []
      records.value = []
      error.value = ''
      loading.value = false
      hasMore.value = false
      loadingMore.value = false
      searching.value = false
      queryKw.value = ''
      return
    }
    const mine = ++loadSeq
    const kw = rowQuery.value.trim()
    loading.value = true
    error.value = ''
    hasMore.value = false
    loadingMore.value = false
    searching.value = false
    try {
      const [fieldList, recordList] = await Promise.all([
        assetApi.listFields(id),
        assetApi.listRecords(id, undefined, 0, PAGE_SIZE, kw || undefined),
      ])
      if (mine !== loadSeq) return
      fields.value = fieldList
      records.value = recordList
      hasMore.value = recordList.length === PAGE_SIZE
      queryKw.value = kw
      if (pendingQuery) {
        rowQuery.value = pendingQuery
        pendingQuery = ''
      }
    } catch (e) {
      if (mine !== loadSeq) return
      fields.value = []
      records.value = []
      hasMore.value = false
      error.value = e instanceof Error ? e.message : '加载记录失败'
    } finally {
      if (mine === loadSeq) loading.value = false
    }
  }

  /** 追加下一页（滚动到底触发）。重入保护 + 竞态保护见下 */
  async function loadMore() {
    const id = tableId.value
    // 重入保护：正在加载 / 正在搜 / 没有更多 / 无表 → 直接返回，避免滚动抖动重复请求同一页
    if (!id || loadingMore.value || searching.value || !hasMore.value) return
    // 捕获当前世代：期间若切表（load() 已 ++loadSeq）则本次结果作废
    const mine = loadSeq
    loadingMore.value = true
    try {
      // 【关键】用 queryKw 而非 rowQuery：保证第 2 页与第 1 页来自**同一个结果集**
      const next = await assetApi.listRecords(
        id, undefined, records.value.length, PAGE_SIZE, queryKw.value || undefined,
      )
      if (mine !== loadSeq) return
      records.value = [...records.value, ...next]
      hasMore.value = next.length === PAGE_SIZE
    } catch (e) {
      if (mine !== loadSeq) return
      ElMessage.error(e instanceof Error ? e.message : '加载更多失败')
    } finally {
      // 仅当世代未变时复位；若已切表，loadingMore 由新世代 load() 负责复位
      if (mine === loadSeq) loadingMore.value = false
    }
  }

  /**
   * 服务端搜索：用 `rowQuery` 当前关键字走 `q` 重拉第 0 页。
   * 与 `queryKw` 相同则跳过（防抖后重复触发不再打请求）。
   * 保护：
   *  - 复用 `loadSeq` 世代号：切表 / 关键字再变都会使在途请求作废，绝不把旧结果盖回来；
   *  - 失败只报一次并停，绝不循环重试。
   */
  async function runSearch() {
    const id = tableId.value
    if (!id) return
    const kw = rowQuery.value.trim()
    if (kw === queryKw.value) return
    const mine = ++loadSeq
    searching.value = true
    error.value = ''
    hasMore.value = false
    loadingMore.value = false
    try {
      const result = await assetApi.listRecords(id, undefined, 0, PAGE_SIZE, kw || undefined)
      if (mine !== loadSeq) return
      records.value = result
      hasMore.value = result.length === PAGE_SIZE
      queryKw.value = kw
      // 请求在途期间用户又改了关键字 → 立即用最新关键字重搜（否则输入框与列表不一致）
      if (rowQuery.value.trim() !== kw) void runSearch()
    } catch (e) {
      if (mine !== loadSeq) return
      records.value = []
      hasMore.value = false
      error.value = e instanceof Error ? e.message : '搜索失败'
    } finally {
      if (mine === loadSeq) searching.value = false
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

  /**
   * 服务端已按 `q` 过滤，前端**不再二次过滤** —— 否则命中数会与后端错位，
   * 且「本地筛后为空、但服务端还有匹配」会误报为无结果。此处直接返回当前页集。
   */
  const visibleRecords = computed(() => records.value)

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

  async function exportExcel() {
    const id = tableId.value
    if (!id) return
    // 【导出 = 用户当前所见，且绝不静默截断】
    //   - 搜索态：带 `q`、**不带 limit** → 后端返回全部**命中**（不是已加载的 50 条），
    //     与本应用「动作作用于筛选结果」的既定语义一致（见列表"全选只作用于当前筛选结果"）。
    //   - 非搜索态：`queryKw` 为空 → 不传 `q` → 全表（与"恒定全表"等价）。
    // 用 `queryKw`（当前展示集实际使用的关键字），**不用 `rowQuery`**：请求在途时用户可能仍在改字，
    // 否则会导出从未上屏的结果集（同 `loadMore` 的理由）。
    const kw = queryKw.value
    try {
      const full = await assetApi.listRecords(id, undefined, undefined, undefined, kw || undefined)
      if (full.length === 0) {
        ElMessage.warning('暂无可导出的记录')
        return
      }
      assetApi.exportRecordsToExcel(full, fields.value, tableName() || '资料导出')
      ElMessage.success(kw ? `已导出 ${full.length} 条（当前筛选「${kw}」）` : `已导出 ${full.length} 条`)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '导出失败')
    }
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
    editTarget, transferIds, crossRecord, catalogDirty, hasMore, loadingMore, searching, queryKw, loadedCount,
    visibleRecords, editOpen, editInitial, relationField,
    load, loadMore, runSearch, loadLinkDetail, applyPendingQuery, setPendingQuery, setSelection,
    openCreate, openEdit, closeEdit, onEditSaved, removeRecord, importFile, exportExcel,
    openTransfer, closeTransfer, onTransferred, openCrossRefs, closeCrossRefs,
  }
}
