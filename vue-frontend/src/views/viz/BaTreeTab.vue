<script setup lang="ts">
/**
 * BA 系统 Tab（/asset-viz?tab=ba）
 * BA 系统 → 设备 逐级下钻；系统节点带问题数徽标（红色 = 有待处理问题），
 * 点设备节点打开详情抽屉。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, WarningFilled } from '@element-plus/icons-vue'
import RelTree from '@/components/common/RelTree.vue'
import { getBaSystemTree } from '@/api/assetViz'
import type { RelNode } from '@/types/assetViz'

const emit = defineEmits<{ (e: 'open-device', code: string): void }>()

const refreshToken = ref(0)
const selectedKey = ref('')

function loader(parent?: string): Promise<RelNode[]> {
  return getBaSystemTree(parent)
}

function onSelect(node: RelNode) {
  selectedKey.value = node.key
  if (node.type === 'ba_device') emit('open-device', String(node.meta?.device_code ?? ''))
}

function expandOnClick(node: RelNode): boolean {
  return node.type !== 'ba_device'
}

function onLoadError(msg: string) {
  ElMessage({ type: 'error', message: msg, duration: 3000 })
}
</script>

<template>
  <div class="batree">
    <section class="panel">
      <header class="panel-head">
        <h2 class="panel-title batree__title">
          <el-icon :size="16"><WarningFilled /></el-icon>
          BA 系统树（BA 系统 → 设备）
        </h2>
        <el-button size="small" @click="refreshToken += 1">
          <el-icon :size="16"><Refresh /></el-icon>
          <span>刷新</span>
        </el-button>
      </header>

      <RelTree
        :loader="loader"
        :reload-key="refreshToken"
        :selected-key="selectedKey"
        :mono-types="['ba_device']"
        empty-text="暂无 BA 系统数据。BA 设备来自「设备档案明细」导入，可到导入子视图补录。"
        :expand-on-click="expandOnClick"
        @select="onSelect"
        @load-error="onLoadError"
      >
        <template #badge="{ node }">
          <el-tag
            v-if="node.type !== 'ba_device' && Number(node.meta?.problem_count ?? 0) > 0"
            size="small"
            type="danger"
            effect="light"
            class="tnum"
          >
            问题 {{ node.meta?.problem_count }}
          </el-tag>
          <el-tag
            v-if="node.type !== 'ba_device' && node.count != null && node.count > 0"
            size="small"
            type="info"
            effect="plain"
            class="tnum"
          >
            {{ node.count }} 设备
          </el-tag>
        </template>
      </RelTree>

      <p class="batree__hint">
        提示：点击 BA 系统展开其下设备（红色徽标为问题数）；点击设备节点查看详情。
      </p>
    </section>
  </div>
</template>

<style scoped>
.batree {
  min-width: 0;
}

.batree__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.batree__hint {
  margin: var(--space-3) 0 0;
  padding-top: var(--space-3);
  border-top: 1px dashed var(--border-soft);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--muted);
}
</style>
