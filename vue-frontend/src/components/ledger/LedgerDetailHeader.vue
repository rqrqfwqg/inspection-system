<script setup lang="ts">
/**
 * 数据表管理 · 单表页头（/asset/ledger/:tableId）
 * =====================================================================
 * 返回、面包屑、表名与徽标（记录数 / 关联覆盖率 / 子系统）、关联键与字段数，
 * 以及行级操作（新增 / Excel 导入 / 导出 / 转移选中）。
 *
 * 从 `LedgerView` 抽出以控制单文件行数（ARCHITECTURE §7 规则 2）。
 * 纪律：隐藏文件输入留在本组件内（只有它知道 input 元素），选中文件后 `file` 事件把文件交回父级；
 * 宽高不写死像素，动作区随容器折行。
 */
import { ref } from 'vue'
import { ArrowLeft, Download, Plus, Switch, Upload } from '@element-plus/icons-vue'

const props = defineProps<{
  tableId: number
  tableName: string
  subsystemName: string
  tableCode: string
  /** 已加载记录数（分页下**非全表总数**，契约不给 total → 不得编造总数） */
  recordCount: number
  /** 是否还有更多未加载（用于把徽标诚实标注为「已加载 N 条，还有更多」） */
  hasMore?: boolean
  fieldCount: number
  coverage: number | null
  relationKeyLabel: string
  importing: boolean
  selectedCount: number
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'create'): void
  (e: 'export'): void
  (e: 'transfer'): void
  (e: 'set-key'): void
  (e: 'file', file: File): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)

function pickFile() {
  fileInput.value?.click()
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (file) emit('file', file)
}

function coveragePercent(): string {
  return props.coverage === null ? '' : `${Math.round(props.coverage * 100)}%`
}
</script>

<template>
  <div class="ldh">
    <el-button class="ldh__back" @click="emit('back')">
      <el-icon :size="16"><ArrowLeft /></el-icon>
      <span>返回数据表</span>
    </el-button>

    <div class="ldh__titles">
      <h1 class="ldh__title">
        <span>{{ props.tableName || `表 #${props.tableId}` }}</span>
        <el-tag size="small" effect="plain" class="tnum">
          已加载 {{ props.recordCount }} 条{{ props.hasMore ? '，还有更多' : '' }}
        </el-tag>
        <el-tag v-if="props.coverage !== null" size="small" type="success" effect="light">
          关联覆盖 {{ coveragePercent() }}
        </el-tag>
        <el-tag v-if="props.subsystemName" size="small" type="info" effect="light">
          {{ props.subsystemName }}
        </el-tag>
      </h1>
      <p class="ldh__sub">
        关联键：
        <button type="button" class="ldh__link-btn" title="点击修改关键键" @click="emit('set-key')">
          {{ props.relationKeyLabel || '未设置' }}
        </button>
        <span class="ldh__dot">·</span>
        字段 <span class="tnum">{{ props.fieldCount }}</span> 个
        <template v-if="props.tableCode">
          <span class="ldh__dot">·</span><span class="mono">{{ props.tableCode }}</span>
        </template>
      </p>
    </div>

    <div class="ldh__actions">
      <el-button type="primary" @click="emit('create')">
        <el-icon :size="16"><Plus /></el-icon>
        <span>新增记录</span>
      </el-button>
      <el-button :loading="props.importing" @click="pickFile">
        <el-icon v-if="!props.importing" :size="16"><Upload /></el-icon>
        <span>{{ props.importing ? '导入中…' : 'Excel 导入' }}</span>
      </el-button>
      <el-button @click="emit('export')">
        <el-icon :size="16"><Download /></el-icon>
        <span>导出</span>
      </el-button>
      <el-button v-if="props.selectedCount > 0" type="primary" plain @click="emit('transfer')">
        <el-icon :size="16"><Switch /></el-icon>
        <span>转移选中 {{ props.selectedCount }} 条</span>
      </el-button>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept=".xlsx,.xls"
      class="ldh__file"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.ldh {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.ldh__back {
  flex: 0 0 auto;
}

.ldh__titles {
  flex: 1 1 auto;
  min-width: 0;
}

.ldh__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--text-xl);
  line-height: var(--leading-tight);
  font-weight: var(--weight-announce);
  letter-spacing: var(--tracking-display);
  color: var(--fg);
}

.ldh__sub {
  margin: var(--space-1) 0 0;
  max-width: 80ch;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.ldh__dot {
  margin: 0 var(--space-1);
  color: var(--border);
}

.ldh__link-btn {
  padding: 0;
  border: none;
  background: none;
  font-size: inherit;
  color: var(--accent);
  cursor: pointer;
}

.ldh__link-btn:hover {
  text-decoration: underline;
}

.ldh__actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.ldh__file {
  display: none;
}

@media (max-width: 1279px) {
  .ldh__title {
    font-size: var(--text-lg);
  }
}
</style>
