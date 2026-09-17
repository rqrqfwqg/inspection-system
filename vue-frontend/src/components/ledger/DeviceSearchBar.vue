<script setup lang="ts">
/**
 * 设备检索输入栏（联想候选）
 * =====================================================================
 * 候选**必须由后端 suggest 提供**（GET /assets/search/suggest，参数名是 `q`）：
 * 现场台账设备多数只存在于 records，前端本地过滤查不到。
 *
 * 行为要点：
 *  - 输入 280ms 防抖；序号递增丢弃过期响应（快速输入不会被先回的旧结果覆盖）；
 *  - 下拉**仅在输入框聚焦时**弹出：URL 直达（?code=xxx）初始化输入框时不得遮挡下方面板；
 *  - 来源徽标区分「设备台账 / 现场台账 / 别名」——现场台账占多数，必须让用户看得见。
 */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Loading, PriceTag, Search, Tickets } from '@element-plus/icons-vue'
import { suggestDevices } from '@/api/search'
import type { DeviceSuggestItem } from '@/types/search'

const props = defineProps<{
  modelValue: string
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'search', code?: string): void
}>()

const items = ref<DeviceSuggestItem[]>([])
const open = ref(false)
const fetching = ref(false)
const rootRef = ref<HTMLElement | null>(null)

let seq = 0
let timer: number | undefined

watch(
  () => props.modelValue,
  (value) => {
    const key = value.trim()
    if (timer !== undefined) window.clearTimeout(timer)
    if (key.length < 2) {
      seq += 1
      items.value = []
      open.value = false
      fetching.value = false
      return
    }
    const mine = ++seq
    fetching.value = true
    timer = window.setTimeout(async () => {
      try {
        const result = await suggestDevices(key, 10)
        if (mine !== seq) return
        items.value = result
        open.value = result.length > 0 && document.activeElement === currentInput()
      } catch {
        if (mine === seq) items.value = []
      } finally {
        if (mine === seq) fetching.value = false
      }
    }, 280)
  },
)

/** 取到真实的 input 元素（el-input 的实例不一定是 DOM 节点） */
function currentInput(): Element | null {
  return rootRef.value?.querySelector('input') ?? null
}

function onFocus() {
  if (items.value.length > 0) open.value = true
}

function pick(item: DeviceSuggestItem) {
  emit('update:modelValue', item.code)
  open.value = false
  emit('search', item.code)
}

function submit() {
  open.value = false
  emit('search')
}

function onDocMouseDown(event: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onDocMouseDown))
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  if (timer !== undefined) window.clearTimeout(timer)
})

function sourceText(item: DeviceSuggestItem): string {
  if (item.in_ledger) return '设备台账'
  return item.source.startsWith('别名') ? '别名' : '现场台账'
}
</script>

<template>
  <div class="dsb">
    <div class="dsb__row">
      <div ref="rootRef" class="dsb__box">
        <el-input
          ref="inputRef"
          :model-value="modelValue"
          class="dsb__input"
          clearable
          aria-label="设备检索关键词"
          placeholder="搜索设备：编号或名称，如 PDF-107 / 配电房 / 排风机"
          @update:model-value="emit('update:modelValue', $event)"
          @focus="onFocus"
          @keydown.enter="submit"
          @keydown.escape="open = false"
        >
          <template #prefix><el-icon :size="16"><Search /></el-icon></template>
          <template v-if="fetching" #suffix>
            <el-icon :size="16" class="dsb__spin"><Loading /></el-icon>
          </template>
        </el-input>

        <ul v-if="open && items.length > 0" class="dsb__menu">
          <li v-for="item in items" :key="item.code">
            <button type="button" class="dsb__item" @click="pick(item)">
              <span class="dsb__item-head">
                <span class="dsb__code mono ellipsis">{{ item.code }}</span>
                <el-tag
                  size="small"
                  :type="item.in_ledger ? 'success' : 'info'"
                  effect="plain"
                  class="dsb__badge"
                >
                  <el-icon :size="16">
                    <Tickets v-if="item.in_ledger" />
                    <PriceTag v-else />
                  </el-icon>
                  <span>{{ sourceText(item) }}</span>
                </el-tag>
              </span>
              <span class="dsb__item-sub">
                <span v-if="item.name" class="ellipsis">{{ item.name }}</span>
                <span v-if="item.subsystem_name">· {{ item.subsystem_name }}</span>
                <span v-if="item.tables && item.tables.length > 0" class="ellipsis">
                  · {{ item.tables.slice(0, 2).join(' / ') }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <el-button type="primary" :loading="loading" @click="submit">检索设备</el-button>
    </div>

    <p class="dsb__tip">
      支持设备编号、名称关键字与编号别名（移交编号 / 资产代码 / BIM 标签）模糊检索。
      真实台账设备（电柜、机房、BA 设备）多数未登记设备主表，同样可检索。
    </p>
  </div>
</template>

<style scoped>
.dsb {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.dsb__row {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
}

.dsb__box {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}

.dsb__input {
  width: 100%;
}

.dsb__spin {
  color: var(--muted);
}

/* 下拉：定位在输入框下方，最宽不超过容器（不撑破页面） */
.dsb__menu {
  position: absolute;
  z-index: var(--z-dropdown);
  top: calc(100% + var(--space-1));
  left: 0;
  right: 0;
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--elev-raised);
}

.dsb__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: none;
  border-bottom: 1px solid var(--border-soft);
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.dsb__item:hover {
  background: var(--accent-soft);
}

.dsb__item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.dsb__code {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.dsb__badge {
  flex: 0 0 auto;
}

.dsb__item-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.dsb__tip {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--muted);
}
</style>
