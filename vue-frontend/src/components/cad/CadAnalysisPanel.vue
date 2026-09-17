<script setup lang="ts">
/**
 * CAD 解析结果面板（CAD 图纸页右列）
 * =====================================================================
 * 展示 GET /cad/parse 的分析结果与 GET /cad/text 的文字实体：
 * 基本信息（2 列）/ 实体类型徽标 / 图层（只列 entity_count>0）/ 文字内容（限高滚动）。
 * 只做展示，不发请求。
 */
import { computed } from 'vue'
import { Coin } from '@element-plus/icons-vue'
import type { CadAnalysis, CadTextItem } from '@/api/misc'

const props = defineProps<{
  analysis: CadAnalysis | null
  texts: CadTextItem[]
  analyzing: boolean
}>()

const entityTypes = computed(() => Object.entries(props.analysis?.entity_types ?? {}))
const layers = computed(() => (props.analysis?.layers ?? []).filter((l) => l.entity_count > 0))
const bbox = computed(() => props.analysis?.bounding_box)

/** 边界框字段是后端 dict 直传，缺字段时呈现「—」而不是 NaN */
function boxDim(key: 'width' | 'height'): string {
  const v = Number(bbox.value?.[key])
  return Number.isFinite(v) ? v.toFixed(1) : '—'
}
</script>

<template>
  <section class="panel cadp min-w-0">
    <div class="cadp__head">
      <el-icon :size="20" class="cadp__head-icon"><Coin /></el-icon>
      <h2 class="cadp__title">分析结果</h2>
    </div>

    <div v-if="analyzing" class="cadp__loading" v-loading="true" element-loading-text="正在解析图纸…" />

    <p v-else-if="!analysis" class="cadp__empty">上传文件后点「分析」查看解析结果</p>

    <div v-else class="cadp__body">
      <div class="cadp__grid">
        <div class="cadp__kv">
          <p class="cadp__k">文件名</p>
          <p class="cadp__v ellipsis">{{ analysis.filename }}</p>
        </div>
        <div class="cadp__kv">
          <p class="cadp__k">DXF 版本</p>
          <p class="cadp__v">{{ analysis.version }}</p>
        </div>
        <div class="cadp__kv">
          <p class="cadp__k">实体总数</p>
          <p class="cadp__v tnum">{{ analysis.total_entities }} 个</p>
        </div>
        <div class="cadp__kv">
          <p class="cadp__k">图纸尺寸</p>
          <p class="cadp__v tnum">{{ boxDim('width') }} × {{ boxDim('height') }}</p>
        </div>
      </div>

      <div v-if="entityTypes.length" class="cadp__section">
        <h3 class="cadp__sub">实体类型</h3>
        <div class="cadp__tags">
          <el-tag v-for="[type, count] in entityTypes" :key="type" size="small" type="info" class="cadp__tag tnum">
            {{ type }}: {{ count }}
          </el-tag>
        </div>
      </div>

      <div v-if="layers.length" class="cadp__section">
        <h3 class="cadp__sub">图层信息</h3>
        <div class="cadp__list">
          <div v-for="layer in layers" :key="layer.name" class="cadp__row">
            <span class="cadp__row-main ellipsis min-w-0">{{ layer.name }}</span>
            <span class="cadp__row-meta tnum">{{ layer.entity_count }} 个实体</span>
          </div>
        </div>
      </div>

      <div v-if="texts.length" class="cadp__section">
        <h3 class="cadp__sub">文字内容（{{ texts.length }}）</h3>
        <div class="cadp__list cadp__list--scroll">
          <div v-for="(t, idx) in texts" :key="idx" class="cadp__row">
            <span class="cadp__row-main break-code min-w-0">{{ t.text }}</span>
            <span v-if="t.layer" class="cadp__row-meta ellipsis">({{ t.layer }})</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cadp { display: flex; flex-direction: column; min-height: 0; }
.cadp__head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.cadp__head-icon { color: var(--accent); }
.cadp__title { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-emphasize); color: var(--fg); }

.cadp__loading { min-height: 200px; }
.cadp__empty { margin: 0; padding: var(--space-8) 0; text-align: center; font-size: var(--text-sm); color: var(--muted); }

.cadp__body { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.cadp__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.cadp__kv { padding: var(--space-3); border-radius: var(--radius-md); background: var(--surface-2); min-width: 0; }
.cadp__k { margin: 0 0 var(--space-1); font-size: var(--text-xs); color: var(--muted); }
.cadp__v { margin: 0; font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }

.cadp__section { min-width: 0; }
.cadp__sub { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-2); font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.cadp__tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.cadp__tag { max-width: 100%; }

.cadp__list { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.cadp__list--scroll { max-height: 160px; overflow: auto; }
.cadp__row {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  min-width: 0;
}
.cadp__row-main { font-size: var(--text-sm); color: var(--fg); }
.cadp__row-meta { flex: 0 0 auto; font-size: var(--text-xs); color: var(--muted); }
</style>
