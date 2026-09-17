<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Loading, Search } from '@element-plus/icons-vue'
import { clampDepth, DEPTH_OPTIONS, suggestDevices } from '@/api/search'
import type { DeviceSuggestItem } from '@/types/search'

const props = defineProps<{
  /** 输入框文本（父级持有：URL 是唯一真源，Deep link 会回写到这里） */
  modelValue: string
  /** 关联深度 1-5 */
  depth: number
  /** 三域检索进行中，用于按钮 loading 态 */
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:depth': [value: number]
  submit: [code: string, depth: number]
}>()

/** AC-11：联想候选必须 300ms 防抖 */
const DEBOUNCE_MS = 300
const PLACEHOLDER = '输入编号：设备资产号 / 电柜编号 / 图纸回路编号 / 别名'

const suggestions = ref<DeviceSuggestItem[]>([])
const suggesting = ref(false)
const inputFocused = ref(false)
const activeIndex = ref(-1)
/** 最近一次「已完成」联想请求的关键词：用来区分「还在查」与「确实没有候选」 */
const settledFor = ref('')
/** 输入框外层容器：选中候选后主动收起焦点，避免候选面板遮挡刚渲染出的结果 */
const fieldRef = ref<HTMLElement | null>(null)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

const keyword = computed(() => props.modelValue.trim())

/** 候选面板可见性：仅聚焦时弹出——URL 直达初始化输入框时不得遮挡下方面板 */
const panelVisible = computed(() => {
  if (!inputFocused.value || keyword.value.length < 2) return false
  return suggesting.value || suggestions.value.length > 0 || settledFor.value === keyword.value
})

/** 空候选：显示引导文案而不是留白（AC-11） */
const showEmptyHint = computed(
  () => !suggesting.value && suggestions.value.length === 0 && settledFor.value === keyword.value,
)

/** 键盘导航的可访问名称（仅高亮项存在时给出） */
const activeDescendant = computed(() =>
  activeIndex.value >= 0 ? `sug-${activeIndex.value}` : undefined,
)

async function load(key: string, mine: number) {
  try {
    const list = await suggestDevices(key, 10)
    if (mine !== seq) return
    suggestions.value = list
    activeIndex.value = -1
  } catch {
    if (mine === seq) suggestions.value = []
  } finally {
    if (mine === seq) {
      settledFor.value = key
      suggesting.value = false
    }
  }
}

watch(
  () => props.modelValue,
  (v) => {
    const key = v.trim()
    if (timer !== undefined) clearTimeout(timer)
    activeIndex.value = -1
    if (key.length < 2) {
      seq += 1
      suggestions.value = []
      suggesting.value = false
      settledFor.value = ''
      return
    }
    suggesting.value = true
    const mine = ++seq
    timer = setTimeout(() => {
      void load(key, mine)
    }, DEBOUNCE_MS)
  },
)

onUnmounted(() => {
  if (timer !== undefined) clearTimeout(timer)
})

function close() {
  suggestions.value = []
  activeIndex.value = -1
  settledFor.value = ''
}

function pick(item: DeviceSuggestItem) {
  emit('update:modelValue', item.code)
  close()
  // 主动 blur：候选是 mousedown.prevent 选中的（输入框没失焦），
  // 若不收起焦点，面板会在新结果上方重新弹出。
  fieldRef.value?.querySelector('input')?.blur()
  emit('submit', item.code, props.depth)
}

function onInput(v: string) {
  emit('update:modelValue', v)
}

/** 深度变更即以当前编号重检索（与 React 版 AssetSearchPage 的 onChange 行为一致） */
function onDepthChange(v: unknown) {
  const d = clampDepth(v)
  emit('update:depth', d)
  if (props.modelValue.trim()) emit('submit', props.modelValue, d)
}

function submitNow() {
  const active = activeIndex.value >= 0 ? suggestions.value[activeIndex.value] : undefined
  if (panelVisible.value && active) {
    pick(active)
    return
  }
  close()
  emit('submit', props.modelValue, props.depth)
}

function onKeydown(e: Event) {
  const evt = e as KeyboardEvent
  const total = suggestions.value.length
  if (evt.key === 'ArrowDown') {
    evt.preventDefault()
    if (!panelVisible.value || total === 0) return
    activeIndex.value = activeIndex.value >= total - 1 ? 0 : activeIndex.value + 1
  } else if (evt.key === 'ArrowUp') {
    evt.preventDefault()
    if (!panelVisible.value || total === 0) return
    activeIndex.value = activeIndex.value <= 0 ? total - 1 : activeIndex.value - 1
  } else if (evt.key === 'Enter') {
    evt.preventDefault()
    submitNow()
  } else if (evt.key === 'Escape') {
    close()
  }
}

/** 来源徽章：现场台账设备占多数，必须让用户看得见 */
function sourceLabel(item: DeviceSuggestItem): string {
  if (item.in_ledger) return '设备台账'
  if (item.source.startsWith('别名')) return '别名'
  return '现场台账'
}

function sourceType(item: DeviceSuggestItem): 'success' | 'info' | 'warning' {
  if (item.in_ledger) return 'success'
  if (item.source.startsWith('别名')) return 'warning'
  return 'info'
}

function metaOf(item: DeviceSuggestItem): string {
  const tables = (item.tables ?? []).slice(0, 2).join(' / ')
  return [item.name, item.subsystem_name ?? '', tables].filter(Boolean).join(' · ')
}
</script>

<template>
  <div class="bar">
    <div ref="fieldRef" class="bar__field">
      <el-input
        :model-value="modelValue"
        :placeholder="PLACEHOLDER"
        class="bar__input"
        size="large"
        clearable
        role="combobox"
        aria-label="检索编号"
        aria-autocomplete="list"
        aria-controls="search-suggest-list"
        :aria-expanded="panelVisible"
        :aria-activedescendant="activeDescendant"
        @update:model-value="onInput"
        @keydown="onKeydown"
        @focus="inputFocused = true"
        @blur="inputFocused = false"
        @clear="close"
      >
        <template #prefix>
          <el-icon :size="16"><Search /></el-icon>
        </template>
        <template #suffix>
          <el-icon v-if="suggesting && inputFocused" :size="16" class="bar__spin"><Loading /></el-icon>
        </template>
      </el-input>

      <div v-if="panelVisible" id="search-suggest-list" class="bar__panel" role="listbox" aria-label="编号候选">
        <p v-if="suggesting && !suggestions.length" class="bar__note">
          <el-icon :size="16" class="bar__spin"><Loading /></el-icon>
          正在检索编号候选…
        </p>
        <template v-else>
          <button
            v-for="(s, i) in suggestions"
            :id="`sug-${i}`"
            :key="s.code"
            type="button"
            role="option"
            :aria-selected="i === activeIndex"
            class="bar__option"
            :class="{ 'is-active': i === activeIndex }"
            @mousedown.prevent="pick(s)"
            @mouseenter="activeIndex = i"
          >
            <span class="bar__option-code mono break-code">{{ s.code }}</span>
            <el-tag size="small" effect="light" :type="sourceType(s)">{{ sourceLabel(s) }}</el-tag>
            <span v-if="metaOf(s)" class="bar__option-meta ellipsis">{{ metaOf(s) }}</span>
          </button>
          <p v-if="showEmptyHint" class="bar__note">
            未找到与「{{ keyword }}」匹配的编号。可直接回车按整串检索，或缩小关键词范围。
          </p>
        </template>
      </div>
    </div>

    <el-select
      :model-value="depth"
      class="bar__depth"
      size="large"
      aria-label="关联深度"
      @change="onDepthChange"
    >
      <el-option v-for="d in DEPTH_OPTIONS" :key="d" :label="`${d} 跳`" :value="d" />
    </el-select>

    <el-button type="primary" size="large" :loading="loading" @click="submitNow">检索</el-button>
  </div>

  <p class="bar__hint">
    支持设备编号、名称关键字与编号别名（移交编号 / 资产代码 / BIM 标签）模糊检索；电柜、配电箱、图纸回路等
    资料域编号同样可检索，一次检索同时命中设备域与资料域。右侧「N 跳」是关联检索深度（默认 2 跳，跳数越大带出的关联设备越多）。
  </p>
</template>

<style scoped>
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

/* 承载长编号的弹性子项必须 min-width:0，否则会把工具条撑破（AC-15） */
.bar__field { position: relative; flex: 1 1 320px; min-width: 0; }
.bar__input { width: 100%; }
.bar__depth { flex: 0 0 auto; width: 108px; }

/* max-height 而非写死高度：候选少时面板按内容收窄，不撑出空白 */
.bar__panel {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  right: 0;
  z-index: var(--z-dropdown);
  max-height: 320px;
  overflow-y: auto;
  padding: var(--space-1) 0;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-raised);
}

.bar__option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 0;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.bar__option.is-active { background: var(--accent-soft); }

.bar__option-code {
  flex: 1 1 160px;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.bar__option-meta {
  flex: 1 1 40%;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.bar__note {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  font-size: var(--text-xs);
  color: var(--muted);
  line-height: var(--leading-body);
}

.bar__spin { animation: bar-spin 1s linear infinite; }

@keyframes bar-spin {
  to { transform: rotate(360deg); }
}

.bar__hint {
  max-width: 72ch;
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
  line-height: var(--leading-body);
}
</style>
