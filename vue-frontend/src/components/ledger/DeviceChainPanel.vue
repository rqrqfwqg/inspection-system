<script setup lang="ts">
/**
 * 供电 / 冷源链路区块（设备数据面板右上）
 * =====================================================================
 * 沿「供电、供配电、上级配电、取电、冷源」关系展示上游 / 本机 / 下游三段。
 * 三方数据（起止点）由父级算好传入，本组件只负责呈现，保持纯展示、易测。
 */
import { computed } from 'vue'
import { ArrowLeft, ArrowRight, Switch } from '@element-plus/icons-vue'
import DeviceChainChips from './DeviceChainChips.vue'
import type { PowerChainNode } from '@/types/asset'

const props = defineProps<{
  /** 本机显示名（缺失时由父级传编号） */
  label: string
  upstream: PowerChainNode[]
  downstream: PowerChainNode[]
}>()

const hasChain = computed(() => props.upstream.length > 0 || props.downstream.length > 0)
</script>

<template>
  <section class="dchain">
    <header class="dchain__head">
      <el-icon :size="16" class="dchain__icon"><Switch /></el-icon>
      <h3 class="dchain__title">供电 / 冷源链路</h3>
      <span class="dchain__hint">沿「供电、供配电、上级配电、取电、冷源」关系追溯</span>
    </header>

    <p v-if="!hasChain" class="dchain__empty">
      未建立供电关系。可在手机扫码页现场补建「上级配电 / 取电」关系后再查看。
    </p>

    <div v-else class="dchain__body">
      <div class="dchain__row">
        <span class="dchain__side">
          <el-icon :size="14"><ArrowLeft /></el-icon>
          <span>上游</span>
        </span>
        <DeviceChainChips :items="upstream" tone="up" />
      </div>

      <div class="dchain__row">
        <span class="dchain__side" />
        <span class="dchain__center">{{ label }}</span>
      </div>

      <div class="dchain__row">
        <span class="dchain__side">
          <el-icon :size="14"><ArrowRight /></el-icon>
          <span>下游</span>
        </span>
        <DeviceChainChips :items="downstream" tone="down" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.dchain {
  min-width: 0;
}

.dchain__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  min-width: 0;
}

.dchain__icon {
  color: var(--muted);
}

.dchain__title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.dchain__hint {
  font-size: var(--text-xs);
  color: var(--muted);
}

.dchain__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.dchain__row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}

.dchain__side {
  flex: 0 0 64px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding-top: 2px;
  font-size: var(--text-xs);
  color: var(--muted);
}

.dchain__center {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: var(--weight-emphasize);
}

.dchain__empty {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}
</style>
