<template>
  <canvas
    :id="canvasId"
    :type="canvasType"
    :style="{ width: size + 'px', height: size + 'px' }"
    class="qr-canvas"
  ></canvas>
</template>

<script setup lang="ts">
import { onMounted, watch, getCurrentInstance } from 'vue'
import drawQrcode from 'weapp-qrcode-canvas-2d'

const props = withDefaults(
  defineProps<{
    /** 二维码内容（文本/编码/URL） */
    text: string
    /** 边长 px */
    size?: number
    /** 前景色 */
    foreground?: string
    /** 背景色 */
    background?: string
  }>(),
  { size: 200, foreground: '#000000', background: '#ffffff' }
)

const canvasId = 'qr-' + Math.random().toString(36).slice(2, 8)
const canvasType = '2d'

function render() {
  if (!props.text) return
  uni
    .createSelectorQuery()
    .in(getCurrentInstance()?.proxy as any)
    .select('#' + canvasId)
    .fields({ node: true, size: true }, (info: any) => {
      if (!info || !info.node) return
      const canvas = info.node
      const dpr = uni.getWindowInfo?.()?.pixelRatio || 2
      canvas.width = props.size * dpr
      canvas.height = props.size * dpr
      drawQrcode({
        canvas,
        canvasId,
        text: props.text,
        width: props.size * dpr,
        height: props.size * dpr,
        foreground: props.foreground,
        background: props.background
      })
    })
    .exec()
}

onMounted(render)
watch(() => props.text, render)
</script>

<style scoped>
.qr-canvas {
  display: block;
}
</style>
