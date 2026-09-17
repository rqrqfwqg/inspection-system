<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import SearchInputBar from '@/components/search/SearchInputBar.vue'
import DeviceSearchResult from '@/components/search/DeviceSearchResult.vue'
import DocSearchResult from '@/components/search/DocSearchResult.vue'
import { clampDepth, DEFAULT_DEPTH, searchAll } from '@/api/search'
import type { SearchBundle } from '@/types/search'

const route = useRoute()
const router = useRouter()

const keyword = ref('')
const depth = ref<number>(DEFAULT_DEPTH)
const bundle = ref<SearchBundle | null>(null)
const loading = ref(false)
const error = ref('')

/** 已完成的检索编号，用作结果区文案与「是否检索过」的判据 */
const searched = computed(() => bundle.value?.keyword ?? '')

/** 任一数据域有返回，用于区分「部分失败」与「全失败」 */
const anyDomain = computed(() => {
  const b = bundle.value
  return !!b && (!!b.resolve || !!b.result || !!b.global)
})

const partialText = computed(() => bundle.value?.errors.join('；') ?? '')

/** 三个域都没命中：走整页空态（设备域 / 资料域各自也各有域内空态） */
const hasAny = computed(() => {
  const b = bundle.value
  if (!b) return false
  return (
    (b.resolve?.count ?? 0) > 0 ||
    (b.result?.found ?? false) ||
    (b.result?.groups.length ?? 0) > 0 ||
    (b.global?.tables_hit ?? 0) > 0
  )
})

/** 示例编号取自真实编号形态（电柜 / 含括号的图纸回路 / 含 # 的编号 / 资产号前缀） */
const EXAMPLES: { code: string; label: string }[] = [
  { code: 'G-1D2ATwb', label: '电柜编号' },
  { code: 'G-P(Y)-RF-01-04', label: '含括号的图纸回路编号' },
  { code: 'C-B1-S-1DDC-1_1#', label: '含 # 的编号（验证 URL 编码）' },
  { code: '105000', label: '资产号前缀（会返回多条候选）' },
]

async function run(kw: string, d: number) {
  const key = kw.trim()
  if (!key) {
    error.value = '请输入编号或关键词后再检索'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const b = await searchAll(key, d)
    bundle.value = b
    if (!b.resolve && !b.result && !b.global) {
      error.value = b.errors.length ? b.errors.join('；') : '检索失败，请稍后重试'
    }
  } catch (e) {
    bundle.value = null
    error.value = e instanceof Error ? e.message : '检索失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function submit(code: string, d: number) {
  const key = code.trim()
  if (!key) {
    error.value = '请输入编号或关键词后再检索'
    return
  }
  const next = clampDepth(d)
  const current = typeof route.query.code === 'string' ? route.query.code : ''
  if (key === current && next === clampDepth(route.query.depth)) {
    // URL 未变时 watch 不触发，这里手动重检索（用户重复点「检索」要有反馈）
    void run(key, next)
    return
  }
  // URL 是检索的唯一真源：可分享、刷新可复现、浏览器后退能回到上一个编号
  void router.push({ path: '/asset/search', query: { code: key, depth: String(next) } })
}

function onKeyword(v: string) {
  keyword.value = v
}

function onDepth(v: number) {
  depth.value = v
}

function onPick(code: string) {
  submit(code, depth.value)
}

function openLedger(code: string) {
  // 站内带参跳转：详情抽屉的深链（读 ?code= 并自动展开）由设备台账页实现，
  // 本页只负责把命中的编号带过去，不在这里重建台账页的交互。
  void router.push({ path: '/asset/devices', query: { code } })
}

function openTable(tableId: number, kw: string) {
  // 带关键词跳到该资料表；行内筛选由数据表管理页实现，本页只保证带参可达
  void router.push({ path: `/asset/ledger/${tableId}`, query: { q: kw } })
}

function clearSearch() {
  if (!route.query.code && !route.query.depth) {
    bundle.value = null
    error.value = ''
    return
  }
  keyword.value = ''
  void router.push({ path: '/asset/search' })
}

function retry() {
  const current = typeof route.query.code === 'string' ? route.query.code : keyword.value
  void run(current, depth.value)
}

// URL 是唯一真源：可分享、刷新可复现、浏览器后退能回到上一个编号。
// watch 用字符串键（而非数组字面量）——数组每次都是新引用，会导致重复触发同一请求。
watch(
  () => `${typeof route.query.code === 'string' ? route.query.code : ''}|${typeof route.query.depth === 'string' ? route.query.depth : ''}`,
  () => {
    const kw = typeof route.query.code === 'string' ? route.query.code : ''
    depth.value = clampDepth(route.query.depth)
    keyword.value = kw
    if (!kw) {
      bundle.value = null
      error.value = ''
      loading.value = false
      return
    }
    void run(kw, depth.value)
  },
  { immediate: true },
)
</script>

<template>
  <div class="search">
    <div class="panel search__bar">
      <SearchInputBar
        :model-value="keyword"
        :depth="depth"
        :loading="loading"
        @update:model-value="onKeyword"
        @update:depth="onDepth"
        @submit="submit"
      />
    </div>

    <div v-if="error" class="panel search__error">
      <el-alert
        type="error"
        :closable="false"
        show-icon
        title="检索未能完成"
        :description="error"
      />
      <div class="search__error-actions">
        <el-button size="small" @click="retry">重试</el-button>
        <el-button size="small" text @click="clearSearch">清空检索条件</el-button>
      </div>
    </div>

    <el-alert
      v-else-if="partialText && anyDomain"
      class="search__alert"
      type="warning"
      :closable="false"
      show-icon
      title="部分数据域未返回"
      :description="partialText"
    />

    <!-- 初始未搜索态：给可用引导与真实示例编号，不留白 -->
    <div v-if="!searched && !loading && !error" class="panel search__intro">
      <el-icon :size="24" class="search__intro-icon"><Search /></el-icon>
      <p class="search__intro-title">输入任意编号开始检索</p>
      <p class="search__intro-text">
        支持已登记设备资产号（105000 开头）、电柜与配电箱编号、图纸回路编号、以及编号别名。
        一次检索同时打设备域（台账反查 + 设备聚合）与资料域（跨资料表模糊搜索），两个域各自独立展示。
      </p>
      <div class="search__examples">
        <span class="search__examples-label">示例编号</span>
        <el-button
          v-for="e in EXAMPLES"
          :key="e.code"
          size="small"
          :title="e.label"
          @click="submit(e.code, depth)"
        >
          <span class="mono break-code">{{ e.code }}</span>
        </el-button>
      </div>
    </div>

    <div
      v-else-if="loading"
      class="search__grid"
      v-loading="loading"
      element-loading-text="正在检索设备域与资料域…"
    >
      <!-- 首次检索给骨架；重检索时保留上一次结果并压暗，避免高度跳变 -->
      <template v-if="!bundle">
        <div v-for="i in 2" :key="i" class="panel search__skeleton">
          <el-skeleton :rows="6" animated />
        </div>
      </template>
      <template v-else>
        <DeviceSearchResult :bundle="bundle" @pick="onPick" @open-ledger="openLedger" />
        <DocSearchResult :bundle="bundle" @pick="onPick" @open-table="openTable" />
      </template>
    </div>

    <template v-else-if="searched && !error">
      <div v-if="!hasAny" class="panel search__empty">
        <el-empty description="设备域与资料域都没有命中">
          <p class="search__empty-text">
            未找到编号 <span class="mono break-code">{{ searched }}</span>：请确认编号是否完整（少一位都查不到），
            或改用更短的片段重试；含 # / ( ) 的编号可整串粘贴，系统按原样编码请求，不会被截断。
          </p>
          <el-button size="small" @click="clearSearch">清空检索条件</el-button>
        </el-empty>
      </div>
      <div v-else class="search__grid">
        <DeviceSearchResult :bundle="bundle" @pick="onPick" @open-ledger="openLedger" />
        <DocSearchResult :bundle="bundle" @pick="onPick" @open-table="openTable" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.search__bar {
  padding: var(--space-4);
}

/* 两个数据域并排；容器窄到放不下时自动降为单列（min() 兜底，永不横向溢出） */
.search__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr));
  align-items: start;
  gap: var(--space-4);
  min-width: 0;
}

.search__intro {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-6);
}

.search__intro-icon {
  color: var(--muted);
}

.search__intro-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.search__intro-text {
  max-width: 72ch;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
  line-height: var(--leading-body);
}

.search__examples {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  min-width: 0;
}

.search__examples-label {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.search__skeleton {
  padding: var(--space-4);
}

.search__empty {
  padding: var(--space-6);
}

.search__empty-text {
  max-width: 60ch;
  margin: 0 auto var(--space-3);
  font-size: var(--text-sm);
  color: var(--muted);
  line-height: var(--leading-body);
}

.search__error {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}

.search__error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
