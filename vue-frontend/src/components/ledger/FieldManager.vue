<script setup lang="ts">
/**
 * 字段定义管理（资料配置 → 资料表与字段）
 * =====================================================================
 * 每行展示：字段中文名 + key + 类型 + 关联键 / 必填标记 + 真实填充率 + 编辑 / 删除。
 *
 * 纪律：
 *  - 填充率来自 `/assets/link/table/{tid}` 的真实记录（`fill_rate`），**不是字段定义里的推测值**；
 *  - 填充率条复用 `components/viz/CoverageBar.vue`（覆盖率可视化全站一个实现）；
 *  - 删除必须二次确认并带字段名与影响面（UIUX §6.6）；失败不静默。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus } from '@element-plus/icons-vue'
import { ref } from 'vue'
import assetApi from '@/api/assetApi'
import CoverageBar from '@/components/viz/CoverageBar.vue'
import FieldFormDialog from './FieldFormDialog.vue'
import { FIELD_TYPE_LABELS } from '@/lib/ledgerLabels'
import type { FieldDef } from '@/types/asset'

const props = defineProps<{
  tableId: number
  tableName?: string
  fields: FieldDef[]
  /** field.id → 真实填充率 0..1（来自 /assets/link/table/{tid}，与记录数据联动） */
  fillRates?: Record<number, number>
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const dialogOpen = ref(false)
const editing = ref<FieldDef | null>(null)

/** 取填充率（缺失返回 null）；用函数而非可选链直读，避免模板里依赖收窄 */
function fillRateOf(fieldId: number): number | null {
  const rate = props.fillRates?.[fieldId]
  return rate === undefined ? null : rate
}

function openAdd() {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(field: FieldDef) {
  editing.value = field
  dialogOpen.value = true
}

async function remove(field: FieldDef) {
  try {
    await ElMessageBox.confirm(
      `将删除「${props.tableName || props.tableId}」上的字段「${field.label}」，`
      + '该字段在已有记录中的取值不再展示（记录其余字段保留）。',
      '删除字段',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await assetApi.deleteField(props.tableId, field.id)
    ElMessage.success(`字段「${field.label}」已删除`)
    emit('changed')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}
</script>

<template>
  <section class="fm">
    <header class="fm__head">
      <h4 class="fm__title">
        字段定义（<span class="tnum">{{ fields.length }}</span>）
        <span class="fm__sub">填充率取自真实记录，随数据更新</span>
      </h4>
      <el-button size="small" @click="openAdd">
        <el-icon :size="16"><Plus /></el-icon>
        <span>新增字段</span>
      </el-button>
    </header>

    <ul v-if="fields.length > 0" class="fm__list">
      <li v-for="field in fields" :key="field.id" class="fm__row">
        <div class="fm__info">
          <span class="fm__label">{{ field.label }}</span>
          <span class="fm__key mono ellipsis" :title="field.key">{{ field.key }}</span>
          <el-tag size="small" type="info" effect="light">{{ FIELD_TYPE_LABELS[field.type] }}</el-tag>
          <el-tag v-if="field.is_relation_key" size="small" effect="dark">关联键</el-tag>
          <el-tag v-if="field.is_search_key" size="small" type="primary" effect="plain">检索钥匙</el-tag>
          <el-tag v-if="field.is_required" size="small" effect="plain">必填</el-tag>
        </div>

        <div v-if="fillRateOf(field.id) !== null" class="fm__rate">
          <span class="fm__rate-label">填充率</span>
          <CoverageBar :value="fillRateOf(field.id) ?? 0" class="fm__rate-bar" />
        </div>

        <div class="fm__actions">
          <el-button link :aria-label="`编辑字段 ${field.label}`" title="编辑字段" @click="openEdit(field)">
            <el-icon :size="16"><Edit /></el-icon>
          </el-button>
          <el-button
            link
            type="danger"
            :aria-label="`删除字段 ${field.label}`"
            title="删除字段"
            @click="remove(field)"
          >
            <el-icon :size="16"><Delete /></el-icon>
          </el-button>
        </div>
      </li>
    </ul>

    <p v-else class="fm__empty">
      这张资料表还没有字段定义：点「新增字段」建立字段（key 为系统标识，label 为中文名），
      之后才能新增记录或从 Excel 导入数据。
    </p>

    <FieldFormDialog
      v-model="dialogOpen"
      :table-id="tableId"
      :editing="editing"
      @saved="emit('changed')"
    />
  </section>
</template>

<style scoped>
.fm {
  min-width: 0;
}

.fm__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.fm__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.fm__sub {
  margin-left: var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-read);
  color: var(--muted);
}

.fm__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.fm__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.fm__info {
  flex: 1 1 320px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
}

.fm__label {
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.fm__key {
  min-width: 0;
  max-width: 220px;
  font-size: var(--text-xs);
  color: var(--muted);
}

.fm__rate {
  flex: 0 1 220px;
  min-width: 140px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.fm__rate-label {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.fm__rate-bar {
  flex: 1 1 auto;
  min-width: 0;
}

.fm__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.fm__empty {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}
</style>
