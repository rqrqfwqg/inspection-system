<script setup lang="ts">
/** 关联图谱图例 —— 线条形态 + 颜色 + 文字三重编码，不靠颜色单独区分（WCAG 1.4.1） */
defineProps<{
  deviceCount: number
  problemCount: number
}>()
</script>

<template>
  <div class="rgl">
    <span class="rgl__key"><i class="rgl__swatch rgl__swatch--root" />当前对象</span>
    <span class="rgl__key"><i class="rgl__swatch rgl__swatch--device" />关联设备（{{ deviceCount }}）</span>
    <span class="rgl__key"><i class="rgl__swatch rgl__swatch--problem" />BA 问题（{{ problemCount }}）</span>
    <span class="rgl__key"><i class="rgl__swatch rgl__swatch--auto" />自动关联（虚线）</span>
    <span class="rgl__key"><i class="rgl__swatch rgl__swatch--manual" />人工关联（实线）</span>
    <span class="rgl__key-hint">点叶子节点即以该对象为中心重看关联</span>
  </div>
</template>

<style scoped>
.rgl {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.rgl__key {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.rgl__key-hint {
  color: var(--muted);
}

/* 图例色块用 CSS 画，不写内联 svg 尺寸 */
.rgl__swatch {
  flex: 0 0 auto;
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: var(--radius-pill);
}

.rgl__swatch--root { background: var(--accent); }
.rgl__swatch--device { background: var(--surface-3); border: 1px solid var(--muted); }
.rgl__swatch--problem { background: var(--danger-bg); border: 1px solid var(--danger); }
.rgl__swatch--auto { height: 0; border-radius: 0; border-top: 2px dashed var(--info); }
.rgl__swatch--manual { height: 0; border-radius: 0; border-top: 2px solid var(--muted); }
</style>
