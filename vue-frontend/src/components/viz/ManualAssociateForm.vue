<script setup lang="ts">
/**
 * 手工建边表单（联动中心 · 待人工关联）。
 * 两端可以是设备、机房，或资料里的编号；写入后标记为「人工关联」，与自动关联在界面可区分。
 * 起/终点用 `v-model:from` / `v-model:to` 由父级持有 —— 父级点候选建议时直接填入，无需 DOM 取值。
 */
import { ref } from 'vue'
import { Link, User } from '@element-plus/icons-vue'

const props = defineProps<{ from: string; to: string; busy: boolean }>()

const emit = defineEmits<{
  (e: 'update:from', v: string): void
  (e: 'update:to', v: string): void
  (e: 'submit', payload: { from: string; to: string; relationType: string; note: string }): void
}>()

const rtype = ref('关联')
const note = ref('')

const TYPES = ['供电', '供配电', '取电', '上级配电', '冷源', '所在机房', '网络', '控制', '管路连接', '配件从属', '关联']

function submit() {
  const from = props.from.trim()
  const to = props.to.trim()
  if (!from || !to) return
  emit('submit', { from, to, relationType: rtype.value, note: note.value.trim() })
  emit('update:from', '')
  emit('update:to', '')
  note.value = ''
}
</script>

<template>
  <div class="maf">
    <p class="maf__head">
      <el-icon :size="16" class="maf__icon"><User /></el-icon>
      <span>手工建边</span>
      <span class="maf__note">两端可以是设备、机房，或资料里的编号</span>
    </p>
    <div class="maf__grid">
      <label class="maf__field">
        <span class="maf__label">起点编号</span>
        <el-input
          :model-value="from"
          placeholder="如 G-1D1AL"
          @update:model-value="emit('update:from', $event)"
        />
      </label>
      <label class="maf__field">
        <span class="maf__label">终点编号</span>
        <el-input
          :model-value="to"
          placeholder="如 GE1F-KTJF-101"
          @update:model-value="emit('update:to', $event)"
        />
      </label>
      <label class="maf__field">
        <span class="maf__label">关系类型</span>
        <el-select v-model="rtype" class="maf__select">
          <el-option v-for="t in TYPES" :key="t" :label="t" :value="t" />
        </el-select>
      </label>
      <label class="maf__field">
        <span class="maf__label">说明（可选）</span>
        <el-input v-model="note" placeholder="现场确认依据" />
      </label>
    </div>
    <div class="maf__foot">
      <el-button type="primary" :disabled="busy || !from.trim() || !to.trim()" @click="submit">
        <el-icon :size="16"><Link /></el-icon>
        <span>建立关联</span>
      </el-button>
      <span class="maf__note">写入后标记为「人工关联」，与自动关联在界面上可区分。</span>
    </div>
  </div>
</template>

<style scoped>
.maf {
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

.maf__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.maf__icon {
  color: var(--warn);
}

.maf__note {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--muted);
}

.maf__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}

.maf__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.maf__label {
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.maf__select {
  width: 100%;
}

.maf__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

@media (max-width: 1279px) {
  .maf__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
