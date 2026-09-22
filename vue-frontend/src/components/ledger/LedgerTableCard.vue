<script setup lang="ts">
/**
 * 资料表概览卡（数据表管理 → 卡片网格的一张）
 * =====================================================================
 * 从 React `AssetLedgerPage.tsx` 内联的三处 IIFE 卡片中抽出，成为可测的原子件：
 * 名称 / 编码 / 子系统 / 记录数 / 字段数 + **关联覆盖率** + 关键键入口。
 *
 * 纪律：
 *  - 覆盖率条复用 `components/viz/CoverageBar.vue`（阈值分档一处实现，不重写）；
 *  - 卡片宽度由父级 Grid 决定，本品**不写死宽度**；长名 / 长编码单行省略（红线 ②）；
 *  - 关键键按钮 `@click.stop`，避免点它误触「进入表维护」。
 */
import { computed } from 'vue'
import { CircleCheck, CircleClose, Delete, EditPen, Grid, Key, List, Tickets } from '@element-plus/icons-vue'
import CoverageBar from '@/components/viz/CoverageBar.vue'
import type { DataTable } from '@/types/asset'
import type { LinkTableStat } from '@/types/assetViz'

const props = defineProps<{
  table: DataTable
  /** 该表的联动画像（缺失 = 尚未算过 / 画像接口不可用 → 只显示「未设置」入口） */
  stat: LinkTableStat | null
}>()

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'set-key'): void
  /** 停用 / 启用该表（软删 / 恢复），由父级确认并调 API */
  (e: 'toggle-active'): void
  /** 彻底删除该表（硬删，仅已停用可用），由父级输入 code 校验后调 API */
  (e: 'delete'): void
}>()

const inactive = computed(() => props.table.is_active === false)

const resolved = computed(() =>
  props.stat ? props.stat.resolved_devices + props.stat.resolved_rooms : 0,
)

const relationKeyText = computed(
  () => props.table.relation_key_label || '未设置（点击设置）',
)
</script>

<template>
  <article
    class="ltc panel"
    :class="{ 'is-inactive': inactive }"
    role="button"
    tabindex="0"
    :aria-label="`进入资料表 ${table.name} 的行数据维护`"
    @click="emit('open')"
    @keydown.enter="emit('open')"
    @keydown.space.prevent="emit('open')"
  >
    <header class="ltc__head">
      <span class="ltc__name-row">
        <el-icon :size="16" class="ltc__icon"><Grid /></el-icon>
        <span class="ltc__name ellipsis" :title="table.name">{{ table.name }}</span>
      </span>
      <span class="ltc__head-side">
        <el-tag v-if="inactive" size="small" type="info" effect="light">已停用</el-tag>
        <el-tag v-if="table.subsystem_name" size="small" type="info" effect="light">
          {{ table.subsystem_name }}
        </el-tag>
        <el-button
          link
          class="ltc__key"
          title="设置关键键（关联键 / 跨表检索键）"
          :aria-label="`设置 ${table.name} 的关键键`"
          @click.stop="emit('set-key')"
        >
          <el-icon :size="16"><Key /></el-icon>
        </el-button>
      </span>
    </header>

    <p class="ltc__code mono ellipsis" :title="table.code">{{ table.code }}</p>

    <div class="ltc__facts">
      <span class="ltc__fact">
        <el-icon :size="14"><Tickets /></el-icon>
        <span class="tnum">{{ table.record_count ?? 0 }}</span>
        <span>条记录</span>
      </span>
      <span class="ltc__fact">
        <el-icon :size="14"><List /></el-icon>
        <span class="tnum">{{ table.field_count ?? 0 }}</span>
        <span>个字段</span>
      </span>
      <span class="ltc__fact ltc__fact--go">
        <el-icon :size="14"><EditPen /></el-icon>
        <span>维护</span>
      </span>
    </div>

    <div class="ltc__link">
      <template v-if="stat">
        <CoverageBar :value="stat.coverage" class="ltc__bar" />
        <div class="ltc__link-meta">
          <span class="ltc__hit">命中 <span class="tnum">{{ resolved }}</span></span>
          <span v-if="stat.unresolved > 0" class="ltc__miss">
            未命中 <span class="tnum">{{ stat.unresolved }}</span>
          </span>
          <button type="button" class="ltc__relkey" title="点击修改关键键" @click.stop="emit('set-key')">
            {{ table.relation_key_label ? `关联键：${table.relation_key_label}` : '无关联键' }}
          </button>
        </div>
      </template>
      <p v-else class="ltc__link-empty">
        关联键：
        <button type="button" class="ltc__relkey" @click.stop="emit('set-key')">
          {{ relationKeyText }}
        </button>
      </p>
    </div>

    <div class="ltc__ops">
      <el-button
        size="small"
        plain
        :type="inactive ? 'primary' : 'default'"
        :aria-label="inactive ? `启用资料表 ${table.name}` : `停用资料表 ${table.name}`"
        @click.stop="emit('toggle-active')"
        @keydown.stop
      >
        <el-icon :size="14"><component :is="inactive ? CircleCheck : CircleClose" /></el-icon>
        <span>{{ inactive ? '启用' : '停用' }}</span>
      </el-button>

      <el-tooltip
        :content="inactive
          ? '彻底删除该表及其全部记录与字段（不可恢复）'
          : '请先停用，确认无影响后再彻底删除'"
        placement="top"
        :show-after="200"
        append-to-body
      >
        <span class="ltc__danger-wrap" @click.stop @keydown.stop>
          <el-button
            size="small"
            type="danger"
            plain
            :disabled="!inactive"
            :aria-label="`彻底删除资料表 ${table.name}`"
            @click.stop="emit('delete')"
            @keydown.stop
          >
            <el-icon :size="14"><Delete /></el-icon>
            <span>彻底删除</span>
          </el-button>
        </span>
      </el-tooltip>
    </div>
  </article>
</template>

<style scoped>
.ltc {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

.ltc:hover,
.ltc:focus-visible {
  border-color: var(--accent);
  box-shadow: var(--elev-raised);
}

.ltc__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.ltc__name-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.ltc__icon {
  flex: 0 0 auto;
  color: var(--accent);
}

.ltc__name {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.ltc__head-side {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.ltc__key {
  color: var(--muted);
}

.ltc__code {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--meta);
}

.ltc__facts {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.ltc__fact {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.ltc__fact--go {
  color: var(--accent);
  font-weight: var(--weight-emphasize);
}

.ltc__link {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-1);
  min-width: 0;
}

.ltc__bar {
  min-width: 0;
}

.ltc__link-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
}

.ltc__hit {
  color: var(--success-fg);
}

.ltc__miss {
  color: var(--warn-fg);
}

.ltc__relkey {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  font-size: var(--text-xs);
  color: var(--muted);
  cursor: pointer;
}

.ltc__relkey:hover {
  color: var(--accent);
  text-decoration: underline;
}

.ltc__link-empty {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--meta);
}

/* 已停用（软删）：卡片灰显，但操作区保持可读，便于恢复 / 彻底清理 */
.ltc.is-inactive {
  background: var(--surface-2);
  border-color: var(--border-soft);
}
.ltc.is-inactive .ltc__icon {
  color: var(--muted);
}
.ltc.is-inactive .ltc__name,
.ltc.is-inactive .ltc__code,
.ltc.is-inactive .ltc__facts,
.ltc.is-inactive .ltc__link {
  opacity: 0.6;
}

.ltc__ops {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-soft);
}

.ltc__danger-wrap {
  display: inline-flex;
}
</style>
