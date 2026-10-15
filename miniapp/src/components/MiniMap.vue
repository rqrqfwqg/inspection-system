<template>
  <view class="gm">
    <!-- 有坐标才渲染 map：<map> 传空经纬度会静默落在几内亚湾，必须挡住 -->
    <map
      v-if="hasPoint"
      class="gm-map"
      :latitude="center.latitude"
      :longitude="center.longitude"
      :scale="scale"
      :markers="markers"
      :polyline="polyline"
      :circles="circles"
      :include-points="includePoints"
      :show-location="showLocation"
      :enable-zoom="true"
      :enable-scroll="true"
      :enable-rotate="false"
      :enable-overlooking="false"
    />
    <view v-else class="gm-empty" :style="{ height: height + 'rpx' }">
      <text class="gm-e-t">{{ emptyTitle }}</text>
      <text class="gm-e-d">{{ emptyDesc }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
/**
 * MiniMap —— 通用地图展示组件（设备定位 / 房间定位 / 工单巡查路线共用）
 *
 * 为什么抽这个组件：三个页面都要画图，但每页的**空态语义不同**
 * （设备没扫过坐标 vs 房间没人去过 vs 工单还没打卡），
 * 把空态文案做成 prop 才能对症下药，不要让每页各写一遍 if。
 *
 * 🔴 三条硬约束（都是踩过的，别改）：
 * 1. **gcj02**：定位观测与打卡坐标都是 gcj02，与微信地图底图同坐标系，
 *    直接用即可；**绝不能**再转 wgs84（会整体偏移几百米）。
 * 2. **绝不塞 (0,0) 兜底坐标**：`<map>` 拿到 (0,0) 会渲染成一片空白海面，
 *    用户以为功能坏了。hasPoint 为 false 时走空态 view，不渲染 map。
 * 3. **精度要展示**：室内定位平均误差 150m，只给一个点会让人误以为是精确位置。
 *    所以 accuracy 一律用 circles 画出来，让误差范围肉眼可见。
 */
import { computed } from 'vue'

export interface MiniMapMarker {
  id: number
  latitude: number
  longitude: number
  title?: string
  /** callout 常显文字（节点序号等） */
  label?: string
  /** callout 是否常显 */
  alwaysShow?: boolean
  /** callout 展示模式（微信 map 组件原生字段） */
  callout?: {
    display?: 'ALWAYS' | 'BYCLICK'
    /** ⚠️ 微信 map callout 的正文字段名是 `content`（不是 `text`，
     *  写错会被原生组件静默忽略 → 气泡一片空白，排查起来很费时间） */
    content?: string
    color?: string
    fontSize?: number
    borderRadius?: number
    bgColor?: string
    padding?: number
    textAlign?: 'center' | 'left' | 'right'
  }
  /** marker 透明度 0~1 */
  opacity?: number
  /** 像素尺寸（自定义 icon 时生效） */
  width?: number
  height?: number
  /** 锚点，默认 {x:.5,y:1} */
  anchor?: { x: number; y: number }
}

export interface MiniMapCircle {
  id: number
  latitude: number
  longitude: number
  /** 米 */
  radius: number
  color?: string
  fillColor?: string
  strokeWidth?: number
}

const props = withDefaults(
  defineProps<{
    markers?: MiniMapMarker[]
    polyline?: Array<{ latitude: number; longitude: number }>
    circles?: MiniMapCircle[]
    /** 地图中心（缺省取第一个 marker / polyline 点） */
    center?: { latitude: number; longitude: number } | null
    scale?: number
    height?: number
    showLocation?: boolean
    emptyTitle?: string
    emptyDesc?: string
  }>(),
  {
    markers: () => [],
    polyline: () => [],
    circles: () => [],
    center: null,
    scale: 16,
    height: 420,
    showLocation: false,
    emptyTitle: '暂无位置数据',
    emptyDesc: '完成扫码定位后即可在地图上显示',
  },
)

/** 过滤非法点：(0,0) 与非数值的脏数据一律剔除，避免地图整体跑偏 */
function valid(lat?: number | null, lng?: number | null): boolean {
  const a = Number(lat)
  const b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  if (a === 0 || b === 0) return false
  // GTC 在东经 113 / 北纬 23，明显越界的坐标同样是脏数据
  if (a < -90 || a > 90 || b < -180 || b > 180) return false
  return true
}

const markers = computed(() =>
  props.markers
    .filter((m) => valid(m.latitude, m.longitude))
    // 只保留小程序 map marker 支持的字段，避免把自定义字段透传给原生组件
    .map((m) => ({
      id: m.id,
      latitude: Number(m.latitude),
      longitude: Number(m.longitude),
      title: m.title || '',
      label: m.label || '',
      alwaysShow: !!m.alwaysShow,
      opacity: typeof m.opacity === 'number' ? m.opacity : 1,
      width: m.width,
      height: m.height,
      anchor: m.anchor,
      callout: m.callout,
    })),
)

const polyline = computed(() =>
  props.polyline
    .filter((p) => valid(p.latitude, p.longitude))
    .map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
)

const circles = computed(() =>
  props.circles
    .filter((c) => valid(c.latitude, c.longitude) && Number(c.radius) > 0)
    .map((c) => ({
      id: c.id,
      latitude: c.latitude,
      longitude: c.longitude,
      radius: Number(c.radius),
      color: c.color || 'rgba(25,137,250,0.5)',
      fillColor: c.fillColor || 'rgba(25,137,250,0.15)',
      strokeWidth: c.strokeWidth || 1,
    })),
)

const hasPoint = computed(() => markers.value.length > 0 || polyline.value.length > 0)

/** 中心点：优先外部指定，否则取第一个可用点 */
const centerPoint = computed(() => {
  const c = props.center
  if (c && valid(c.latitude, c.longitude)) {
    return { latitude: Number(c.latitude), longitude: Number(c.longitude) }
  }
  const m = markers.value[0]
  if (m) return { latitude: m.latitude, longitude: m.longitude }
  const p = polyline.value[0]
  if (p) return { latitude: p.latitude, longitude: p.longitude }
  return { latitude: 23.3626, longitude: 113.3206 }
})

const center = computed(() => centerPoint.value)

/** 有多个点时把 include-points 交给 map 自动缩放到刚好装下所有点 */
const includePoints = computed(() => {
  const pts = markers.value.map((m) => ({ latitude: m.latitude, longitude: m.longitude }))
  if (pts.length >= 2) return { points: pts, padding: 80 }
  return undefined
})

defineExpose({ hasPoint })
</script>

<style scoped lang="scss">
.gm {
  width: 100%;
}
.gm-map {
  width: 100%;
  border-radius: $tm-radius;
  overflow: hidden;
}
.gm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f2f3f5;
  border-radius: $tm-radius;
  border: 1rpx dashed #dcdee0;
}
.gm-e-t {
  font-size: 27rpx;
  color: $tm-text-secondary;
  font-weight: 600;
}
.gm-e-d {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: $tm-text-muted;
  padding: 0 40rpx;
  text-align: center;
  line-height: 1.6;
}
</style>
