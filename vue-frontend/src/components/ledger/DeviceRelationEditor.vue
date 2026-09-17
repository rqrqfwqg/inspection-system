<script setup lang="ts">
/**
 * 设备关联编辑（单设备视角）
 * =====================================================================
 * 列出与该设备相关的全部边（出边 + 入边），支持新增一条人工关联、删除已有边。
 *
 * 纪律：删除边影响的是「关联链路」，不动设备本身资料，确认文案写清双向关系（UIUX §6.6）。
 */
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import assetApi from '@/api/assetApi'
import type { Device, DeviceRelation } from '@/types/asset'

const props = defineProps<{
  deviceCode: string
  relations: DeviceRelation[]
  devices: Device[]
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const toCode = ref('')
const relationType = ref('关联')
const saving = ref(false)

const myRelations = computed(() =>
  props.relations.filter((r) => r.from_code === props.deviceCode || r.to_code === props.deviceCode),
)

const others = computed(() => props.devices.filter((d) => d.device_code !== props.deviceCode))

function otherCodeOf(relation: DeviceRelation): string {
  return relation.from_code === props.deviceCode ? relation.to_code : relation.from_code
}

async function add() {
  if (!toCode.value) {
    ElMessage.warning('请先选择要关联的设备')
    return
  }
  saving.value = true
  try {
    await assetApi.createRelation({
      from_code: props.deviceCode,
      to_code: toCode.value,
      relation_type: relationType.value.trim() || '关联',
    })
    ElMessage.success('关联已添加')
    toCode.value = ''
    relationType.value = '关联'
    emit('changed')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '添加失败')
  } finally {
    saving.value = false
  }
}

async function remove(relation: DeviceRelation) {
  const other = otherCodeOf(relation)
  try {
    await ElMessageBox.confirm(
      `将删除「${props.deviceCode}」与「${other}」之间的「${relation.relation_type}」关联。`
      + '删除只影响链路关系，双方的设备资料与记录均保留。',
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
  <section class="dre">
    <div class="dre__form">
      <label class="dre__field">
        <span class="dre__label">关联设备</span>
        <el-select v-model="toCode" class="dre__select" filterable placeholder="选择设备…">
          <el-option
            v-for="device in others"
            :key="device.id"
            :label="`${device.device_code} · ${device.name}`"
            :value="device.device_code"
          />
        </el-select>
      </label>

      <label class="dre__field dre__field--type">
        <span class="dre__label">关系类型</span>
        <el-input v-model="relationType" placeholder="如 供电 / 上级配电 / 所在机房" />
      </label>

      <el-button type="primary" :loading="saving" @click="add">
        <el-icon :size="16"><Plus /></el-icon>
        <span>添加关联</span>
      </el-button>
    </div>

    <ul v-if="myRelations.length > 0" class="dre__list">
      <li v-for="relation in myRelations" :key="relation.id" class="dre__row">
        <el-tag size="small" effect="plain">{{ relation.relation_type }}</el-tag>
        <span class="dre__code mono break-code">{{ otherCodeOf(relation) }}</span>
        <el-button
          link
          type="danger"
          class="dre__del"
          :aria-label="`删除与 ${otherCodeOf(relation)} 的关联`"
          title="删除该关联"
          @click="remove(relation)"
        >
          <el-icon :size="16"><Delete /></el-icon>
        </el-button>
      </li>
    </ul>

    <p v-else class="dre__empty">
      该设备还没有任何关联：可用上方表单建立「供电 / 上级配电 / 所在机房」等关系，建立后即可在关系图上追溯链路。
    </p>
  </section>
</template>

<style scoped>
.dre {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.dre__form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-2);
  min-width: 0;
}

.dre__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1 1 240px;
  min-width: 0;
}

.dre__field--type {
  flex: 0 1 200px;
}

.dre__label {
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.dre__select {
  width: 100%;
}

.dre__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.dre__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.dre__code {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--fg-2);
}

.dre__del {
  flex: 0 0 auto;
}

.dre__empty {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}
</style>
