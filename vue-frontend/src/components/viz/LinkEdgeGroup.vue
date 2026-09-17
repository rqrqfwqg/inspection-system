<script setup lang="ts">
/**
 * 关联边分组列表（自动 / 人工分列）
 *
 * 每条边展示：关系类型 + 对端类别 + 方向 + 对端编号 + 对端名称 + 命中规则 + 判定证据；
 * 点编号即下钻到对端（台账设备 / 电柜 / 配电箱 / 图纸回路都能接得上）。
 *
 * 相对 React 版的两处调整（都不减功能）：
 *  1. 去掉 `border-left: 2px` 的彩色粗边条 —— 左侧彩色条纹是典型的 AI 模板语言，
 *     设计规范也明确「卡片不用左侧彩色粗边条」；改用来源徽标 + 中性描边表达。
 *  2. 证据文本用 `.ellipsis` 单行省略 + tooltip 兜底，长证据不再把行撑爆。
 */
import { Cpu, Link, User } from '@element-plus/icons-vue'
import { fmtValue } from '@/lib/format'
import type { DeviceLinkEdge } from '@/types/assetViz'

withDefaults(
  defineProps<{
    title: string
    /** auto = 规则引擎自动建立 / manual = 人工建立 */
    tone?: 'auto' | 'manual'
    edges: DeviceLinkEdge[]
  }>(),
  { tone: 'manual' },
)

const emit = defineEmits<{ (e: 'select-code', code: string): void }>()

const OTHER_KIND_LABEL: Record<string, string> = {
  device: '设备',
  room: '机房',
  record: '资料编号',
  unknown: '未知',
}

function kindText(kind: string): string {
  return OTHER_KIND_LABEL[kind] ?? '未知'
}
</script>

<template>
  <div class="leg">
    <p class="leg__head" :class="tone === 'auto' ? 'leg__head--auto' : ''">
      <el-icon :size="16"><Cpu v-if="tone === 'auto'" /><User v-else /></el-icon>
      <span>{{ title }}（{{ edges.length }}）</span>
    </p>

    <ul class="leg__list">
      <li v-for="e in edges" :key="e.id" class="leg__item">
        <div class="leg__row">
          <el-tag size="small" effect="light" :type="tone === 'auto' ? 'primary' : 'info'">
            {{ e.relation_type }}
          </el-tag>
          <span class="leg__kind">{{ kindText(e.other_kind) }}</span>
          <span class="leg__dir" :title="e.direction === 'out' ? '本对象指向对端' : '对端指向本对象'">
            {{ e.direction === 'out' ? '→' : '←' }}
          </span>
          <el-tooltip :content="`以 ${e.other_code} 为中心查看关联`" placement="top" :show-after="300" append-to-body>
            <button type="button" class="leg__code mono break-code" @click="emit('select-code', e.other_code)">
              {{ e.other_code }}
            </button>
          </el-tooltip>
          <span v-if="e.other_name" class="leg__name ellipsis" :title="e.other_name">{{ e.other_name }}</span>
          <span v-if="e.rule" class="leg__rule">规则 {{ e.rule }}</span>
        </div>
        <p v-if="e.evidence" class="leg__evidence ellipsis" :title="fmtValue(e.evidence)">
          <el-icon :size="16" class="leg__evidence-icon"><Link /></el-icon>
          {{ fmtValue(e.evidence) }}
        </p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.leg {
  min-width: 0;
}

.leg__head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-emphasize);
  color: var(--fg-2);
}

.leg__head--auto {
  color: var(--info-fg);
}

.leg__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* 中性描边承载每条边；不用彩色侧边条（AI 模板语言） */
.leg__item {
  padding: var(--space-2);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface);
  min-width: 0;
}

.leg__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-sm);
}

.leg__kind,
.leg__dir,
.leg__rule {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.leg__dir {
  color: var(--fg-2);
}

.leg__code {
  flex: 0 1 auto;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  font-size: var(--text-sm);
  color: var(--fg);
  text-align: left;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--border);
  text-underline-offset: 2px;
  transition: color var(--motion-fast) var(--ease-standard);
}

.leg__code:hover,
.leg__code:focus-visible {
  color: var(--accent);
  text-decoration-color: currentColor;
}

.leg__name {
  flex: 1 1 140px;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.leg__evidence {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.leg__evidence-icon {
  flex: 0 0 auto;
  color: var(--meta);
}
</style>
