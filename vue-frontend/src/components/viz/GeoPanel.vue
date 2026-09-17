<script setup lang="ts">
/**
 * 现场定位（精确坐标）—— 扫码即记，只写观测表、不动台账。
 * 时间字段后端落库是 UTC → 一律走 fmtBeijingUtc() +8 显示为北京时间。
 * 精度缺失**绝不补 ±0m**（accToneOf / fmtAcc 已把「未知」与「0」区分开）。
 */
import { computed } from 'vue'
import { Aim, Link } from '@element-plus/icons-vue'
import { GEO_NOISE_METERS, accToneOf, driftMeters, fmtAcc, fmtBeijingUtc, fmtCoord } from '@/lib/format'
import type { GeoObservation } from '@/types/assetViz'

const props = defineProps<{ geo: GeoObservation[]; name?: string }>()

/** 坐标对文本（6 位小数，复用 format 的唯一口径）；任一非法返回空串 */
function coordTextOf(g?: GeoObservation | null): string {
  if (!g) return ''
  const lat = fmtCoord(g.latitude)
  const lng = fmtCoord(g.longitude)
  return lat === '—' || lng === '—' ? '' : `${lat}, ${lng}`
}

const latest = computed(() => props.geo[0] ?? null)
const coordText = computed(() => coordTextOf(latest.value))

const accTone = computed(() => accToneOf(latest.value?.accuracy))
const accType = computed(() =>
  accTone.value === 'exact' ? 'success' : accTone.value === 'coarse' ? 'warning' : 'info',
)
const accText = computed(() => {
  if (accTone.value === 'unknown') return '精度未知'
  const a = Number(latest.value?.accuracy)
  return accTone.value === 'exact' ? `精确 ${fmtAcc(a)}` : `精度偏弱 ${fmtAcc(a)}`
})

const timeText = computed(() => fmtBeijingUtc(latest.value?.observed_at))
const coordType = computed(() => String(latest.value?.coord_type || 'gcj02').toUpperCase())

const mapUrl = computed(() => {
  const g = latest.value
  if (!coordText.value || !g) return ''
  const name = encodeURIComponent(props.name || g.device_code || '')
  return (
    'https://uri.amap.com/marker' +
    `?position=${Number(g.longitude)},${Number(g.latitude)}` +
    `&name=${name}&coordinate=gaode&callnative=1`
  )
})

const driftText = computed(() => {
  const a = props.geo[0]
  const b = props.geo[1]
  if (!a || !b) return ''
  const d = driftMeters(a.latitude, a.longitude, b.latitude, b.longitude)
  if (d === null || d < GEO_NOISE_METERS) return ''
  return `较上次观测偏移约 ${d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`}`
})

const history = computed(() => props.geo.slice(1, 6))
</script>

<template>
  <section class="geo panel">
    <header class="panel-head geo__head">
      <h3 class="panel-title geo__title">
        <el-icon :size="16"><Aim /></el-icon>
        <span>现场定位（精确坐标）</span>
      </h3>
      <el-tag v-if="latest" size="small" :type="accType" effect="light">{{ accText }}</el-tag>
      <span v-if="geo.length > 1" class="geo__count">历史 {{ geo.length }} 条</span>
      <span class="geo__note">小程序扫码时自动记录 · 只记观测不动台账</span>
    </header>

    <p v-if="!latest || !coordText" class="geo__empty">
      暂无现场坐标记录。在微信小程序「设备卡」扫码查询该设备时，会自动记一条手机定位（需开启位置权限）——
      室内漂移较大，据此判断位置时可先看精度。
    </p>

    <div v-else class="geo__body">
      <div class="geo__grid">
        <div class="geo__cell">
          <p class="geo__cell-label">最新坐标（{{ coordType }}）</p>
          <p class="geo__cell-value mono tnum">{{ coordText }}</p>
        </div>
        <div class="geo__cell">
          <p class="geo__cell-label">定位精度</p>
          <p class="geo__cell-value">{{ fmtAcc(latest.accuracy) }}</p>
        </div>
        <div class="geo__cell">
          <p class="geo__cell-label">记录时间（北京时间）</p>
          <p class="geo__cell-value">{{ timeText }}</p>
        </div>
      </div>

      <div class="geo__meta">
        <span v-if="latest.room_code">记录时所在机房：<b>{{ latest.room_code }}</b></span>
        <span v-if="latest.operator">记录人：<b>{{ latest.operator }}</b></span>
        <a v-if="mapUrl" class="geo__maplink" :href="mapUrl" target="_blank" rel="noreferrer">
          地图查看<el-icon :size="16"><Link /></el-icon>
        </a>
      </div>

      <p v-if="driftText" class="geo__drift">
        {{ driftText }}（可能被挪动，或台账位置有误 —— 超过 {{ GEO_NOISE_METERS }}m 才提示）
      </p>

      <div v-if="history.length" class="geo__history">
        <p class="geo__history-title">历史记录（最新在前）</p>
        <p v-for="(g, i) in history" :key="g.id ?? i" class="geo__history-row">
          <span class="mono tnum">{{ coordTextOf(g) || '—' }}</span>
          <span>{{ fmtAcc(g.accuracy) }}</span>
          <span>{{ fmtBeijingUtc(g.observed_at) }}</span>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.geo {
  min-width: 0;
}

.geo__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.geo__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.geo__count,
.geo__note {
  font-size: var(--text-xs);
  color: var(--muted);
}

.geo__note {
  margin-left: auto;
}

.geo__empty {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.geo__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.geo__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.geo__cell {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-2);
}

.geo__cell-label {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.geo__cell-value {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--fg);
  word-break: break-word;
}

.geo__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.geo__maplink {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--accent);
  text-decoration: none;
}

.geo__maplink:hover {
  text-decoration: underline;
}

.geo__drift {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--warn-fg);
}

.geo__history {
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border-soft);
}

.geo__history-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.geo__history-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

@media (max-width: 1023px) {
  .geo__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
