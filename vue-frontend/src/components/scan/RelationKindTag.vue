<script setup lang="ts">
/**
 * 关联类型徽章（kinds → 分类色）。
 * 承接 React 版 DeviceRelationPanel.tsx 的 relationKindBadge / KIND_STYLE：
 * 并入本组件统一渲染（React 里是导出的样式函数，Vue 里做成单一展示组件，
 * 供 DeviceRelationPanel 与 ScanDeviceView 复用），颜色全部走 tokens 的子系统色。
 * 色差偏离登记：network 原 React 用紫色，本站刻意规避紫色系 → 用 --sys-weak 青绿。
 */
withDefaults(defineProps<{ kind?: string; text: string }>(), { kind: 'other' })
</script>

<template>
  <span class="rk" :class="`rk--${kind}`">{{ text }}</span>
</template>

<style scoped>
.rk {
  display: inline-flex; align-items: center;
  flex: 0 0 auto;
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs); line-height: 20px;
  white-space: nowrap;
}
.rk--power     { color: var(--sys-hvac);     border-color: color-mix(in srgb, var(--sys-hvac) 35%, #fff);     background: color-mix(in srgb, var(--sys-hvac) 10%, #fff); }
.rk--cooling   { color: var(--sys-refrig);   border-color: color-mix(in srgb, var(--sys-refrig) 35%, #fff);   background: color-mix(in srgb, var(--sys-refrig) 10%, #fff); }
.rk--locate    { color: var(--fg-2);         border-color: var(--border);        background: var(--surface-3); }
.rk--network   { color: var(--sys-weak);     border-color: color-mix(in srgb, var(--sys-weak) 35%, #fff);     background: color-mix(in srgb, var(--sys-weak) 10%, #fff); }
.rk--control   { color: var(--sys-power);    border-color: color-mix(in srgb, var(--sys-power) 35%, #fff);    background: color-mix(in srgb, var(--sys-power) 10%, #fff); }
.rk--pipe      { color: var(--success-fg);   border-color: color-mix(in srgb, var(--success) 35%, #fff);      background: var(--success-bg); }
.rk--accessory { color: var(--sys-lighting); border-color: color-mix(in srgb, var(--sys-lighting) 35%, #fff); background: color-mix(in srgb, var(--sys-lighting) 10%, #fff); }
.rk--other     { color: var(--muted);        border-color: var(--border);        background: var(--surface-2); }
</style>
