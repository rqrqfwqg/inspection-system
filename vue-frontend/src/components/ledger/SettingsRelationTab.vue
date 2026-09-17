<script setup lang="ts">
/**
 * 资料配置 · 关联管理 Tab
 * =====================================================================
 * 三块：来源构成（`RelationSourceSummary`）+ 新建人工关联 + 关联列表（筛选 / 删除）。
 *
 * 纪律：
 *  - 来源判定唯一走 `@/lib/ledgerLabels#relationSourceOf`（只有 `meta.source === 'auto'` 才算自动，
 *    无标记历史边一律按人工——与后端 `unmarked_legacy` 口径一致，避免两处判定漂移）；
 *  - 表格列**只用 min-width**（红线 ③），横滚交给 `.data-table-wrap`；
 *  - 删除边只影响链路，不动两端设备资料，确认文案写清这一点（UIUX §6.6）。
 */
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection, Delete } from '@element-plus/icons-vue'
import assetApi from '@/api/assetApi'
import RelationSourceSummary from './RelationSourceSummary.vue'
import { metaText, relationSourceOf } from '@/lib/ledgerLabels'
import type { Device, DeviceRelation } from '@/types/asset'
import type { LinkOverview } from '@/types/assetViz'

const props = defineProps<{
  overview: LinkOverview | null
  relations: DeviceRelation[]
  devices: Device[]
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const relFrom = ref('')
const relTo = ref('')
const relType = ref('关联')
const sourceFilter = ref<'all' | 'auto' | 'manual'>('all')
const keyword = ref('')
const saving = ref(false)

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return props.relations.filter((relation) => {
    if (sourceFilter.value !== 'all' && relationSourceOf(relation.meta) !== sourceFilter.value) {
      return false
    }
    if (kw && !`${relation.from_code} ${relation.to_code}`.toLowerCase().includes(kw)) return false
    return true
  })
})

function ruleOf(relation: DeviceRelation): string {
  return metaText(relation.meta, 'rule')
}

function sourceTitle(relation: DeviceRelation): string {
  if (relationSourceOf(relation.meta) === 'auto') {
    return metaText(relation.meta, 'evidence') || '规则引擎自动建立'
  }
  return '人工建立（网页 / 小程序 / 历史导入）'
}

async function addRelation() {
  if (!relFrom.value || !relTo.value) {
    ElMessage.warning('请选择源设备与目标设备')
    return
  }
  if (relFrom.value === relTo.value) {
    ElMessage.warning('源设备与目标设备不能相同')
    return
  }
  saving.value = true
  try {
    await assetApi.createRelation({
      from_code: relFrom.value,
      to_code: relTo.value,
      relation_type: relType.value.trim() || '关联',
      meta: { source: 'manual', via: 'web-config' },
    })
    ElMessage.success('关联已添加（人工）')
    relFrom.value = ''
    relTo.value = ''
    relType.value = '关联'
    emit('changed')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '添加失败')
  } finally {
    saving.value = false
  }
}

async function removeRelation(relation: DeviceRelation) {
  try {
    await ElMessageBox.confirm(
      `将删除「${relation.from_code}」→「${relation.to_code}」的「${relation.relation_type}」关联。`
      + '删除只影响链路关系，两端设备的资料与记录均保留。',
      '删除关联',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await assetApi.deleteRelation(relation.id)
    ElMessage.success('关联已删除')
    emit('changed')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}
</script>

<template>
  <div class="srtab">
    <RelationSourceSummary :overview="props.overview" :fallback-total="props.relations.length" />

    <div class="srtab__form">
      <label class="srtab__field">
        <span class="srtab__field-label">源设备</span>
        <el-select v-model="relFrom" class="srtab__field-ctl" filterable placeholder="选择源设备">
          <el-option
            v-for="device in props.devices"
            :key="device.id"
            :label="`${device.device_code} · ${device.name}`"
            :value="device.device_code"
          />
        </el-select>
      </label>

      <label class="srtab__field">
        <span class="srtab__field-label">目标设备</span>
        <el-select v-model="relTo" class="srtab__field-ctl" filterable placeholder="选择目标设备">
          <el-option
            v-for="device in props.devices"
            :key="device.id"
            :label="`${device.device_code} · ${device.name}`"
            :value="device.device_code"
          />
        </el-select>
      </label>

      <label class="srtab__field srtab__field--type">
        <span class="srtab__field-label">关系类型</span>
        <el-input v-model="relType" placeholder="如 供电 / 上级配电 / 所在机房" />
      </label>

      <el-button type="primary" :loading="saving" @click="addRelation">
        <el-icon :size="16"><Connection /></el-icon>
        <span>添加关联</span>
      </el-button>
    </div>

    <div class="srtab__filter">
      <el-input
        v-model="keyword"
        class="srtab__search"
        clearable
        aria-label="按编号搜索关联（源 / 目标）"
        placeholder="按编号搜索（源 / 目标）"
      />
      <el-select v-model="sourceFilter" class="srtab__source-filter" aria-label="按来源筛选">
        <el-option label="全部来源" value="all" />
        <el-option label="仅自动关联" value="auto" />
        <el-option label="仅人工关联" value="manual" />
      </el-select>
      <span class="srtab__count">
        显示 <span class="tnum">{{ filtered.length }}</span> / <span class="tnum">{{ props.relations.length }}</span> 条
      </span>
    </div>

    <div class="data-table-wrap srtab__table">
      <el-table :data="filtered" border row-key="id">
        <el-table-column label="源设备" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono break-code">{{ row.from_code }}</span>
          </template>
        </el-table-column>

        <el-table-column label="关系" min-width="140">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.relation_type }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="目标设备" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono break-code">{{ row.to_code }}</span>
          </template>
        </el-table-column>

        <el-table-column label="来源" min-width="200">
          <template #default="{ row }">
            <span class="srtab__cell-source" :title="sourceTitle(row as DeviceRelation)">
              <el-tag
                size="small"
                effect="plain"
                :type="relationSourceOf(row.meta) === 'auto' ? 'primary' : 'info'"
              >
                {{ relationSourceOf(row.meta) === 'auto' ? '自动关联' : '人工关联' }}
              </el-tag>
              <span
                v-if="relationSourceOf(row.meta) === 'auto' && ruleOf(row as DeviceRelation)"
                class="srtab__cell-rule"
              >
                {{ ruleOf(row as DeviceRelation) }}
              </span>
            </span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="80" align="right">
          <template #default="{ row }">
            <el-button
              link
              type="danger"
              :aria-label="`删除关联 ${row.from_code} 到 ${row.to_code}`"
              title="删除该关联"
              @click="removeRelation(row as DeviceRelation)"
            >
              <el-icon :size="16"><Delete /></el-icon>
            </el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :image-size="72" description="暂无关联记录：可用上方表单人工建立，或在联动中心运行自动关联" />
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.srtab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.srtab__form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
  min-width: 0;
}

.srtab__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1 1 220px;
  min-width: 0;
}

.srtab__field--type {
  flex: 0 1 180px;
}

.srtab__field-label {
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.srtab__field-ctl {
  width: 100%;
}

.srtab__filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.srtab__search {
  flex: 1 1 220px;
  max-width: 320px;
}

.srtab__source-filter {
  flex: 0 0 clamp(140px, 14vw, 180px);
}

.srtab__count {
  font-size: var(--text-xs);
  color: var(--muted);
}

.srtab__table {
  min-width: 0;
  max-width: 100%;
}

.srtab__cell-source {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.srtab__cell-rule {
  font-size: var(--text-xs);
  color: var(--info-fg);
}
</style>
