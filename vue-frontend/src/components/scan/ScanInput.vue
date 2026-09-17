<script setup lang="ts">
/**
 * 现场扫码输入（键盘 + 摄像头双通道）。
 *
 * - 扫码枪 / PDA 本质是键盘，扫完自动补回车：输入框常驻聚焦，Enter 即提交、
 *   清空并重新聚焦，可连续作业；busy 期间丢弃后续扫码，防止连扫重复建边。
 * - 摄像头通道：点按钮切换，html5-qrcode 走动态 import（不用则不加载该代码）。
 *   stop() 在「扫描器未运行」时会同步抛异常，必须吞掉（摄像头不可用是最常见情况）。
 * - 内容解析走 parseScanPayload：标签二维码是 /ops/qr/<编号> 直达链接，
 *   扫码枪会输出整条 URL，此处自动提取编号，也兼容手输纯编号。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { Aim, Camera, Loading, VideoPause } from '@element-plus/icons-vue'
import { parseScanPayload } from '@/api/scan'

/** html5-qrcode 只声明用到的接口，避免强依赖其类型导出形态 */
interface Html5QrcodeLike {
  start: (camera: unknown, config: unknown, onSuccess: (text: string) => void, onFailure?: () => void) => Promise<void>
  stop: () => Promise<void>
  clear: () => void
}

const props = withDefaults(
  defineProps<{
    onScan: (code: string, raw: string) => void | Promise<void>
    disabled?: boolean
    placeholder?: string
    /** 是否提供摄像头扫码（默认提供；动态引入，不用则不加载） */
    enableCamera?: boolean
  }>(),
  { disabled: false, placeholder: '', enableCamera: true },
)

const value = ref('')
const cameraOn = ref(false)
const camError = ref('')
const busy = ref(false)
/** el-input 实例自带 focus()，这里只依赖该方法（供 busy 后重新聚焦） */
const inputRef = ref<{ focus: () => void } | null>(null)

/** 挂载点 id 按实例唯一：html5-qrcode 需要真实 DOM 元素，同页多实例不能冲突 */
const regionId = `scan-camera-region-${++regionSeq}`

let busyFlag = false

async function emitScan(raw: string) {
  const code = parseScanPayload(raw)
  if (!code || busyFlag) return
  busyFlag = true
  busy.value = true
  try {
    await props.onScan(code, raw)
  } finally {
    busyFlag = false
    busy.value = false
  }
}

async function commit() {
  const raw = value.value
  if (!raw.trim()) return
  value.value = ''
  await emitScan(raw)
  if (!cameraOn.value) inputRef.value?.focus()
}

function toggleCamera() {
  cameraOn.value = !cameraOn.value
}

/** 摄像头生命周期：只随 cameraOn 开关启停；卸载兜底停机 */
let stopCamera: (() => void) | null = null

watch(cameraOn, (on) => {
  if (!on || !props.enableCamera) return
  let cancelled = false
  let inst: Html5QrcodeLike | null = null
  /** 只有 start() 真正成功后才允许 stop() */
  let started = false

  const safeStop = () => {
    const s = inst
    if (!s || !started) return
    started = false
    try {
      const p = s.stop()
      if (p && typeof p.then === 'function') {
        p.then(() => {
          try { s.clear() } catch { /* 容器可能已卸载 */ }
        }).catch(() => undefined)
      }
    } catch { /* 未运行/已暂停：忽略 */ }
  }

  void (async () => {
    camError.value = ''
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (cancelled || !document.getElementById(regionId)) return
      const qr = new Html5Qrcode(regionId, { verbose: false }) as unknown as Html5QrcodeLike
      inst = qr
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (text: string) => { void emitScan(text) },
        () => undefined,
      )
      started = true
      if (cancelled) safeStop()
    } catch (e) {
      if (!cancelled) {
        camError.value = e instanceof Error ? e.message : '摄像头启动失败'
        cameraOn.value = false
      }
    }
  })()

  stopCamera = () => {
    cancelled = true
    safeStop()
  }
})

onBeforeUnmount(() => {
  stopCamera?.()
  stopCamera = null
})

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<script lang="ts">
let regionSeq = 0
</script>

<template>
  <div class="scan-input">
    <div class="scan-input__row">
      <el-input
        ref="inputRef"
        v-model="value"
        class="scan-input__field"
        :disabled="disabled || busy"
        :autofocus="!cameraOn"
        autocomplete="off"
        spellcheck="false"
        :placeholder="placeholder || '扫码枪对准条码，扫完自动添加；或手输编号后回车'"
        @keydown.enter.prevent="commit"
      >
        <template #prefix>
          <el-icon :size="16"><Aim /></el-icon>
        </template>
      </el-input>
      <el-button
        class="scan-input__btn"
        type="primary"
        :disabled="disabled || busy || !value.trim()"
        @click="commit"
      >
        <el-icon v-if="busy" :size="16" class="is-loading"><Loading /></el-icon>
        <span>{{ busy ? '处理中' : '添加' }}</span>
      </el-button>
      <el-tooltip
        v-if="enableCamera"
        :content="cameraOn ? '关闭摄像头' : '用摄像头扫码'"
        :show-after="300"
        append-to-body
      >
        <el-button
          class="scan-input__btn"
          :type="cameraOn ? 'danger' : 'default'"
          :disabled="disabled"
          @click="toggleCamera"
        >
          <el-icon :size="16"><VideoPause v-if="cameraOn" /><Camera v-else /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <div v-if="cameraOn" class="scan-input__cam">
      <div :id="regionId" class="scan-input__region" />
      <p class="scan-input__hint">对准二维码，识别成功自动添加并继续扫描。</p>
    </div>
    <p v-if="camError" class="scan-input__err" role="alert">
      摄像头不可用：{{ camError }}（需 HTTPS 访问并授权相机）
    </p>
    <p v-if="!cameraOn && !disabled" class="scan-input__hint">
      识别到二维码直达链接时自动提取设备编号；重复扫同一台会提示「已在清单」。
    </p>
  </div>
</template>

<style scoped>
.scan-input { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.scan-input__row { display: flex; gap: var(--space-2); min-width: 0; }
.scan-input__field { flex: 1 1 auto; min-width: 0; }
.scan-input__field :deep(.el-input__inner) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.scan-input__btn { flex: 0 0 auto; }
.scan-input__cam { display: flex; flex-direction: column; gap: var(--space-1); }
.scan-input__region { width: 100%; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-2); }
.scan-input__region :deep(video) { width: 100%; height: auto; border-radius: var(--radius-lg); }
.scan-input__hint { margin: 0; font-size: var(--text-xs); color: var(--muted); }
.scan-input__err { margin: 0; font-size: var(--text-xs); color: var(--danger-fg); }
</style>
