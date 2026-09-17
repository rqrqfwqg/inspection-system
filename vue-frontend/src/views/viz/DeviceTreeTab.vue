<script setup lang="ts">
/**
 * 设备层级 Tab（/asset-viz?tab=device）
 * 子系统 → 设备类型（同名聚合）→ 主设备（带编号）→ 配件 / 子设备。
 * 左树 + 右「节点详情」：点分组展开设备清单，点主设备既选中又可直接打开详情。
 *
 * 与 React 版一致：配件（accessory）是叶节点，只选中不展开、不跳转。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Box, Cpu, Tools } from '@element-plus/icons-vue'
import RelTree from '@/components/common/RelTree.vue'
import { getDeviceTree } from '@/api/assetViz'
import type { RelNode } from '@/types/assetViz'

const emit = defineEmits<{ (e: 'open-device', code: string): void }>()

const refreshToken = ref(0)
const selected = ref<RelNode | null>(null)

function loader(parent?: string): Promise<RelNode[]> {
  return getDeviceTree(parent)
}

function onSelect(node: RelNode) {
  selected.value = node
  if (node.type === 'device' && node.meta?.is_group !== true) {
    emit('open-device', String(node.meta?.device_code ?? ''))
  }
}

/** 只有「按子系统分组」的入口节点点击才展开（点主设备是看详情，不是展开） */
function expandOnClick(node: RelNode): boolean {
  return node.meta?.is_group === true
}

function onLoadError(msg: string) {
  ElMessage({ type: 'error', message: msg, duration: 3000 })
}

const isGroup = computed(() => selected.value?.meta?.is_group === true)
const isDevice = computed(
  () => selected.value?.type === 'device' && selected.value?.meta?.is_group !== true,
)

const kindText = computed(() => {
  if (!selected.value) return ''
  if (isGroup.value) return String(selected.value.meta?.group_label ?? '') || '子系统分组'
  return selected.value.type === 'accessory' ? '配件' : '设备'
})

/** meta 里的原始键值全量呈现（键名由后端定义，前端不猜语义、不改名） */
const metaRows = computed<{ key: string; value: string }[]>(() => {
  const meta = selected.value?.meta ?? {}
  return Object.entries(meta)
    .filter(([, v]) => v != null && v !== '')
    .map(([key, value]) => ({ key, value: String(value) }))
})

const selectedCode = computed(() => String(selected.value?.meta?.device_code ?? ''))
</script>

<template>
  <div class="devtree">
    <section class="panel devtree__main">
      <header class="panel-head">
        <h2 class="panel-title devtree__title">
          <el-icon :size="16"><Cpu /></el-icon>
          设备层级树（子系统 → 主设备 → 配件 / 子设备）
        </h2>
        <el-button size="small" @click="refreshToken += 1">刷新</el-button>
      </header>

      <RelTree
        :loader="loader"
        :reload-key="refreshToken"
        :selected-key="selected?.key ?? ''"
        :mono-types="['device']"
        empty-text="暂无设备数据。若刚完成台账导入，请点击「刷新」重新加载。"
        :expand-on-click="expandOnClick"
        @select="onSelect"
        @load-error="onLoadError"
      />

      <p class="devtree__hint">
        提示：层级为 子系统 → 设备类型（同名聚合）→ 主设备（带编号）→ 配件 / 子设备；
        点类型分组展开设备清单，点主设备查看详情。
      </p>
    </section>

    <section class="panel devtree__side">
      <header class="panel-head">
        <h2 class="panel-title devtree__title">节点详情</h2>
      </header>

      <p v-if="!selected" class="devtree__note">
        点选左侧节点查看详情。分组节点给出该分组下的设备数，主设备节点可直接打开完整档案。
      </p>

      <div v-else class="devtree__detail">
        <p class="devtree__head">
          <el-icon :size="16" class="devtree__icon">
            <Box v-if="isGroup" />
            <Tools v-else-if="selected.type === 'accessory'" />
            <Cpu v-else />
          </el-icon>
          <span class="devtree__label ellipsis" :title="selected.label">{{ selected.label }}</span>
          <el-tag size="small" type="info" effect="plain">{{ kindText }}</el-tag>
        </p>

        <el-button v-if="isDevice" class="devtree__open" @click="emit('open-device', selectedCode)">
          查看设备详情
        </el-button>

        <dl v-if="metaRows.length" class="devtree__meta">
          <div v-for="row in metaRows" :key="row.key" class="devtree__meta-row">
            <dt class="devtree__meta-key ellipsis" :title="row.key">{{ row.key }}</dt>
            <dd class="devtree__meta-val">{{ row.value }}</dd>
          </div>
        </dl>
      </div>
    </section>
  </div>
</template>

<style scoped>
.devtree {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
  min-width: 0;
}

.devtree__main,
.devtree__side {
  min-width: 0;
}

.devtree__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.devtree__hint {
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: 1px dashed var(--border-soft);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--muted);
}

.devtree__note {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.devtree__detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.devtree__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  min-width: 0;
}

.devtree__icon {
  color: var(--muted);
}

.devtree__label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.devtree__open {
  align-self: flex-start;
}

.devtree__meta {
  margin: 0;
  min-width: 0;
  border-top: 1px dashed var(--border-soft);
}

.devtree__meta-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--border-soft);
  min-width: 0;
}

.devtree__meta-key {
  flex: 0 0 auto;
  width: 40%;
  font-size: var(--text-xs);
  color: var(--muted);
}

.devtree__meta-val {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg);
  word-break: break-word;
}

@media (max-width: 1279px) {
  .devtree {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
