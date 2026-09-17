<script setup lang="ts">
/** 概览 · 底部双栏：未关联编号 TOP（需人工处理） + BA 问题概览 */
import { Warning } from '@element-plus/icons-vue'
import { fmtInt, fmtPercent } from '@/lib/format'
import type { BaOverviewItem, LinkUnresolvedItem } from '@/types/assetViz'

defineProps<{
  unresolved: LinkUnresolvedItem[]
  unresolvedCodes: number
  unresolvedRecords: number
  ba: { problems: number; normal: number; total: number }
  baRows: BaOverviewItem[]
}>()

const emit = defineEmits<{ (e: 'go-link'): void }>()
</script>

<template>
  <div class="obp__two">
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title obp__title">
          <el-icon :size="16"><Warning /></el-icon>
          <span>未关联编号 TOP</span>
          <span class="obp__note">
            共 {{ fmtInt(unresolvedCodes) }} 个编号 · {{ fmtInt(unresolvedRecords) }} 条记录
          </span>
        </h3>
      </header>
      <p v-if="unresolved.length === 0" class="obp__desc">全部编号都已关联。</p>
      <template v-else>
        <ul class="obp__list">
          <li v-for="u in unresolved.slice(0, 10)" :key="u.code" class="obp__list-item">
            <span class="mono obp__code">{{ u.code }}</span>
            <el-tag size="small" type="info" effect="light" class="tnum">{{ u.records }} 条</el-tag>
            <span class="obp__tables ellipsis" :title="u.tables.join('、')">{{ u.tables.slice(0, 2).join('、') }}</span>
          </li>
        </ul>
        <div class="obp__foot">
          <el-button size="small" @click="emit('go-link')">去联动中心处理</el-button>
          <span class="obp__hint">现场可用小程序扫码建边</span>
        </div>
      </template>
    </section>

    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title obp__title">
          <el-icon :size="16"><Warning /></el-icon>
          <span>BA 问题概览</span>
        </h3>
      </header>
      <div class="obp__ba">
        <div class="obp__ba-cell">
          <p class="obp__ba-label">待处理问题</p>
          <p class="obp__ba-value tnum obp__danger">{{ fmtInt(ba.problems) }}</p>
        </div>
        <div class="obp__ba-cell">
          <p class="obp__ba-label">正常</p>
          <p class="obp__ba-value tnum">{{ fmtInt(ba.normal) }}</p>
        </div>
        <div class="obp__ba-cell">
          <p class="obp__ba-label">点位数</p>
          <p class="obp__ba-value tnum obp__muted">{{ fmtInt(ba.total) }}</p>
        </div>
      </div>
      <ul class="obp__list obp__list--scroll">
        <li v-for="o in baRows" :key="o.ba_system_code" class="obp__list-item">
          <span class="obp__sys ellipsis" :title="String(o.ba_system)">{{ o.ba_system }}</span>
          <span class="obp__ba-tags">
            <el-tag size="small" type="danger" effect="light" class="tnum">{{ o.problem }}</el-tag>
            <span class="obp__hint tnum">{{ fmtPercent(o.problem_rate) }}</span>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.obp__two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.obp__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.obp__note,
.obp__hint {
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  color: var(--muted);
}

.obp__desc {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.obp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 16rem;
  overflow-y: auto;
}

.obp__list--scroll {
  max-height: 10rem;
  padding-top: var(--space-1);
}

.obp__list-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--border-soft);
  font-size: var(--text-sm);
}

.obp__code {
  color: var(--fg);
}

.obp__tables,
.obp__sys {
  flex: 1 1 140px;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.obp__ba-tags {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
}

.obp__foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.obp__ba {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-bottom: var(--space-2);
}

.obp__ba-label {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.obp__ba-value {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: var(--weight-announce);
  color: var(--fg);
}

.obp__muted { color: var(--fg-2); }
.obp__danger { color: var(--danger-fg); }

@media (max-width: 1279px) {
  .obp__two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
