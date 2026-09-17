<script setup lang="ts">
/** 导入结果区 —— 逐文件给出成功/失败、命中模板、行数、提示与错误 */
import { CircleCheck, Warning } from '@element-plus/icons-vue'
import { templateLabel, type FileResult } from './importShared'

defineProps<{ results: FileResult[] }>()
</script>

<template>
  <div class="irl">
    <p class="irl__title">导入结果</p>
    <div
      v-for="r in results"
      :key="r.id"
      class="irl__item"
      :class="r.ok ? 'irl__item--ok' : 'irl__item--fail'"
    >
      <div class="irl__head">
        <el-icon :size="16">
          <CircleCheck v-if="r.ok" class="irl__ok-icon" /><Warning v-else class="irl__fail-icon" />
        </el-icon>
        <span class="irl__name ellipsis">{{ r.filename }}</span>
        <el-tag v-if="r.dry_run" size="small" type="info" effect="light">校验</el-tag>
        <el-tag v-if="r.ok && r.template" size="small" type="info" effect="plain">
          {{ templateLabel(r.template) }}
        </el-tag>
      </div>
      <p v-if="r.ok" class="irl__body">
        主设备/记录 <b>{{ r.rows ?? 0 }}</b> 条
        <template v-if="typeof r.accessory_rows === 'number' && r.accessory_rows > 0">
          ，配件 <b>{{ r.accessory_rows }}</b> 条
        </template>
        <span v-if="r.batches && r.batches.length > 1" class="irl__muted">（{{ r.batches.length }} 个分表）</span>
      </p>
      <p v-else class="irl__error">{{ r.error }}</p>
      <ul v-if="r.warnings && r.warnings.length > 0" class="irl__list irl__list--warn">
        <li v-for="(w, i) in r.warnings.slice(0, 5)" :key="i">{{ w }}</li>
        <li v-if="r.warnings.length > 5">…等 {{ r.warnings.length }} 条提示</li>
      </ul>
      <ul v-if="r.errors && r.errors.length > 0" class="irl__list irl__list--err">
        <li v-for="(e, i) in r.errors" :key="i">{{ e }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.irl {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.irl__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.irl__item {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.irl__item--ok {
  border-color: var(--success);
  background: var(--success-bg);
}

.irl__item--fail {
  border-color: var(--danger);
  background: var(--danger-bg);
}

.irl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.irl__ok-icon {
  color: var(--success);
}

.irl__fail-icon {
  color: var(--danger);
}

.irl__name {
  min-width: 0;
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.irl__body {
  margin: var(--space-1) 0 0;
  color: var(--fg-2);
}

.irl__error {
  margin: var(--space-1) 0 0;
  color: var(--danger-fg);
}

.irl__muted {
  color: var(--muted);
}

.irl__list {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-4);
  font-size: var(--text-xs);
}

.irl__list--warn {
  color: var(--warn-fg);
}

.irl__list--err {
  color: var(--danger-fg);
}
</style>
