<script setup lang="ts">
/**
 * 关键键弹窗的字段列表（关联键单选 + 跨表检索键多选）
 * =====================================================================
 * 「关联键」需要「再点一次可取消」的语义，故用原生 input（radio/checkbox）而非 el-radio-group 强制单选；
 * 勾选态颜色走 `accent-color: var(--accent)`（无字面色值）。
 *
 * 从 `TableKeyDialog` 抽出以控制单文件行数（ARCHITECTURE §7 规则 2）；本组件**纯受控**，
 * 只发 toggle 事件，状态与 diff 提交留在弹窗层。
 */
import { InfoFilled, Key, Search, WarningFilled } from '@element-plus/icons-vue'
import type { FieldDef } from '@/types/asset'

defineProps<{
  fields: FieldDef[]
  tableId: number
  relId: number | null
  searchIds: number[]
  /** 关联键被改动（提示保存后会重算已有记录的 device_code） */
  relationKeyChanged: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-relation', fieldId: number): void
  (e: 'toggle-search', fieldId: number): void
}>()
</script>

<template>
  <div class="tkfl">
    <div class="tkfl__head">
      <span class="tkfl__mark" />
      <span class="tkfl__col-field">字段</span>
      <span class="tkfl__col">关联键</span>
      <span class="tkfl__col">跨表检索键</span>
    </div>

    <div
      v-for="field in fields"
      :key="field.id"
      class="tkfl__row"
      :class="{ 'tkfl__row--rel': relId === field.id }"
    >
      <span class="tkfl__mark">
        <el-icon v-if="relId === field.id" :size="16" class="tkfl__mark-rel"><Key /></el-icon>
        <el-icon v-else-if="searchIds.includes(field.id)" :size="16" class="tkfl__mark-search"><Search /></el-icon>
      </span>

      <span class="tkfl__field">
        <span class="tkfl__label ellipsis" :title="field.label">{{ field.label }}</span>
        <span class="tkfl__key mono ellipsis" :title="field.key">{{ field.key }}</span>
        <el-tag v-if="field.is_required" size="small" effect="plain">必填</el-tag>
      </span>

      <span class="tkfl__col">
        <input
          type="radio"
          class="tkfl__cb"
          :name="`rel-key-${tableId}`"
          :checked="relId === field.id"
          :aria-label="`把 ${field.label} 设为关联键（全表唯一）`"
          title="设为关联键（全表唯一；再点一次取消）"
          @change="emit('toggle-relation', field.id)"
        />
      </span>

      <span class="tkfl__col">
        <input
          type="checkbox"
          class="tkfl__cb"
          :checked="searchIds.includes(field.id)"
          :aria-label="`把 ${field.label} 设为跨表检索键`"
          title="设为跨表检索键（可多选）"
          @change="emit('toggle-search', field.id)"
        />
      </span>
    </div>

    <p v-if="relationKeyChanged" class="tkfl__warn">
      <el-icon :size="16"><WarningFilled /></el-icon>
      <span>
        你更换了关联键：保存后该表**已有记录的 device_code 会按新字段值自动重算**
        （新字段为空的记录保持原值不动），这会影响这些记录挂到哪台设备 / 机房。
      </span>
    </p>

    <p class="tkfl__note">
      <el-icon :size="16"><InfoFilled /></el-icon>
      <span>
        「关联键」全表唯一 —— 勾选新的会自动取消旧的；不勾任何字段即表示该表无关联键（记录不挂设备）。
      </span>
    </p>
  </div>
</template>

<style scoped>
.tkfl {
  min-width: 0;
}

.tkfl__head,
.tkfl__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.tkfl__head {
  padding: 0 var(--space-2) var(--space-1);
  font-size: var(--text-xs);
  color: var(--meta);
}

.tkfl__row {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-1);
}

.tkfl__row--rel {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.tkfl__mark {
  flex: 0 0 20px;
  display: inline-flex;
  justify-content: center;
}

.tkfl__mark-rel {
  color: var(--accent);
}

.tkfl__mark-search {
  color: var(--info-fg);
}

.tkfl__col-field {
  flex: 1 1 auto;
  min-width: 0;
}

.tkfl__col {
  flex: 0 0 96px;
  display: flex;
  justify-content: center;
}

.tkfl__field {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.tkfl__label {
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg);
}

.tkfl__key {
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.tkfl__cb {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.tkfl__warn,
.tkfl__note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  line-height: var(--leading-body);
}

.tkfl__warn {
  border: 1px solid var(--warn);
  background: var(--warn-bg);
  color: var(--warn-fg);
}

.tkfl__note {
  border: 1px solid var(--border-soft);
  background: var(--surface-2);
  color: var(--fg-2);
}
</style>
