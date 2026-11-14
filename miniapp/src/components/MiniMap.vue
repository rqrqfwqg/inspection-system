<template>
  <view class="gm">
    <!-- 有坐标才渲染 map：<map> 传空经纬度会静默落在几内亚湾，必须挡住 -->
    <map
      v-if="hasPoint"
      :id="MAP_ID"
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
    <!-- 只有「我」的坐标、没有任何业务点位时：地图照常显示，并在下方点明这是当前位置 -->
    <view class="gm-hint" v-if="hasPoint && !hasBizPoint">
      <text>{{ hintText }}</text>
    </view>
    <!-- 一键回到我的位置（有业务点位时，用户常常拖动地图后找不到自己） -->
    <view class="gm-locate" v-if="hasPoint && myPos" @tap="backToMyLocation">
      <text class="gm-locate-dot"></text>
      <text>我的位置</text>
    </view>
    <!-- 反过来：默认落在我的位置，需要看点位时一键跳过去（设备 / 房间 / 打卡点） -->
    <view class="gm-focus" v-if="hasPoint && hasBizPoint" @tap="focusBiz">
      <text>{{ focusLabel }}</text>
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
import { computed, onMounted, ref } from 'vue'
import { getCurrentPoint } from '@/composables/useGeolocation'
import { GTC_CENTER, isNearGTC } from '@/api/geo'

/** map 组件的 id：`createMapContext` 要靠它拿到上下文（回到我的位置 / 跳到点位） */
const MAP_ID = 'gm-map'

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
    /**
     * 是否优先以「我的位置」为中心（默认 **false**）。
     * 用户口径（2026-11-14）：「设备定了定位就固定，打开就是设备位置；起码默认白云机场」——
     * 所以默认一律以业务点位为首选，我的位置只作右下角一键跳转。
     * 需要「打开就看到自己」的页面才显式传 true。
     */
    preferMyLocation?: boolean
    /** 「跳到点位」用的目标坐标（缺省取第一个业务点位） */
    focusPoint?: { latitude: number; longitude: number } | null
    /** 「跳到点位」按钮文案，按页面语义传：看设备位置 / 看打卡点 … */
    focusLabel?: string
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
    preferMyLocation: false,
    focusPoint: null,
    focusLabel: '看点位',
    scale: 16,
    height: 420,
    showLocation: true,
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

/**
 * 是否落在 GTC 现场合理范围（排除离群脏点）。
 *
 * 线上混入过 5 条海珠区坐标（23.1062,113.3245，开发者工具模拟定位），
 * 一旦参与定中心 / 自动缩放，整张地图会被拉到 30km 外 —— 现场看到的就是「飘到海珠」。
 * 离群点仍照常画在图上（不隐藏真实数据），只是**不参与视野计算**。
 */
function inScope(lat?: number | null, lng?: number | null): boolean {
  return valid(lat, lng) && isNearGTC(lat, lng)
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

/** 是否有业务点位（设备 / 房间 / 线路节点 / 打卡点） */
const hasBizPoint = computed(() => markers.value.length > 0 || polyline.value.length > 0)

/**
 * 我方实时坐标（**只用于地图视野与蓝点**）。
 *
 * 🔴 与打卡的关系：这里取到的坐标**绝不参与打卡判定/打卡记录**。
 * 打卡仍按既有铁律「以用户手动获取的坐标为准」，禁自动定位（2026-10-23 定案）。
 * 本处仅解决「地图一打开落在默认城市（广州）而不是用户身边」的观感问题。
 *
 * 取不到就静默降级（未授权 / 室内无解 / 隐私未声明都不弹错、不阻断页面）。
 *
 * 2026-11-14 起：本坐标**只用于右下角「我的位置」一键跳转**，
 * 默认视野由业务点位 / 白云机场 GTC 决定，不再受手机定位漂移影响。
 */
const myPos = ref<{ latitude: number; longitude: number } | null>(null)
onMounted(() => {
  void (async () => {
    const { point } = await getCurrentPoint()
    if (point && valid(point.latitude, point.longitude)) {
      myPos.value = { latitude: point.latitude, longitude: point.longitude }
    }
  })()
})

/** 有业务点位、或有我方坐标，都值得渲染地图（不再直接掉进空态） */
const hasPoint = computed(() => hasBizPoint.value || !!myPos.value)

/** 没有业务点位时，如实说明当前显示的是自己还是机场兜底 */
const hintText = computed(() => {
  const me = myPos.value && inScope(myPos.value.latitude, myPos.value.longitude)
  return `${props.emptyTitle} · 当前显示${me ? '您的实时位置' : '白云机场 GTC'}`
})

/** 第一个「现场范围内」的业务点位，用于定中心与「跳到点位」兜底 */
const anchorPoint = computed(() => {
  const m = markers.value.find((x) => inScope(x.latitude, x.longitude))
  if (m) return { latitude: m.latitude, longitude: m.longitude }
  const p = polyline.value.find((x) => inScope(x.latitude, x.longitude))
  if (p) return { latitude: p.latitude, longitude: p.longitude }
  return null
})

/**
 * 中心点优先级（2026-11-14 按用户口径重排）：
 * ① 外部显式指定（须在现场范围内）→ ② **业务点位**（设备/房间/打卡点）
 * → ③ 我的位置（须在现场范围内）→ ④ 白云机场 GTC
 *
 * 为什么从「我的位置优先」改回来：机场室内定位常漂移，1.9.1 起默认以手机定位为中心，
 * 结果打开设备详情看到的是几十公里外（甚至海珠区），被当成地图坏了。
 * 用户口径是「设备定了定位就固定，打开就是设备位置；起码默认白云机场」。
 * 我的位置仍保留右下角一键跳转，需要时点一下即可。
 */
const centerPoint = computed(() => {
  const c = props.center
  if (c && inScope(c.latitude, c.longitude)) {
    return { latitude: Number(c.latitude), longitude: Number(c.longitude) }
  }
  // 手机定位漂到现场范围外时，宁可不用，也不要把地图带去海珠
  const me =
    myPos.value && inScope(myPos.value.latitude, myPos.value.longitude) ? myPos.value : null
  if (me && props.preferMyLocation) return me
  if (anchorPoint.value) return anchorPoint.value
  if (me) return me
  return { latitude: GTC_CENTER.latitude, longitude: GTC_CENTER.longitude }
})

const center = computed(() => centerPoint.value)

/**
 * 有多个点时交给 map 自动缩放到刚好装下所有**现场**点位。
 *
 * ⚠️ 只统计 inScope 的点：混入一条海珠区脏坐标就会把视野拉到 30km 外。
 * 明确要求「我的位置优先」时不传，避免 include-points 覆盖默认中心。
 */
const includePoints = computed(() => {
  if (myPos.value && props.preferMyLocation) return undefined
  const pts = markers.value
    .filter((m) => inScope(m.latitude, m.longitude))
    .map((m) => ({ latitude: m.latitude, longitude: m.longitude }))
  if (pts.length >= 2) return { points: pts, padding: 80 }
  return undefined
})

/** 把视野移到目标坐标（回到我的位置 / 跳到业务点位共用） */
function moveTo(p: { latitude: number; longitude: number }): void {
  if (!p) return
  try {
    const ctx: any = (uni as any).createMapContext(MAP_ID)
    if (ctx && typeof ctx.moveToLocation === 'function') {
      ctx.moveToLocation({ latitude: p.latitude, longitude: p.longitude })
    }
  } catch {
    // 基础库/开发者工具不支持时不打扰用户，点位本身仍在图上
  }
}

/** 一键把视野移回我方位置（地图被拖动后找回自己） */
function backToMyLocation(): void {
  if (!myPos.value) return
  moveTo(myPos.value)
}

/** 一键跳到业务点位（默认本机位置时，用来查看设备 / 打卡点） */
function focusBiz(): void {
  const target = props.focusPoint && valid(props.focusPoint.latitude, props.focusPoint.longitude)
    ? { latitude: Number(props.focusPoint!.latitude), longitude: Number(props.focusPoint!.longitude) }
    : anchorPoint.value
  if (target) moveTo(target)
}

defineExpose({ hasPoint })
</script>

<style scoped lang="scss">
.gm {
  width: 100%;
  position: relative;
}
/* 只有我方坐标时，点明「这是您的实时位置」，避免被误读成设备位置 */
.gm-hint {
  margin-top: 10rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
  line-height: 1.6;
}
/* 回到我的位置：右下角胶囊，半透明白底，不抢地图主体 */
.gm-locate {
  position: absolute;
  right: 16rpx;
  bottom: 16rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  height: 56rpx;
  padding: 0 20rpx;
  border-radius: 28rpx;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.14);
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.gm-locate-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #1989fa;
}
/* 跳到业务点位：与「我的位置」左右分列，默认落在我这儿，需要时一键过去 */
.gm-focus {
  position: absolute;
  left: 16rpx;
  bottom: 16rpx;
  display: flex;
  align-items: center;
  height: 56rpx;
  padding: 0 20rpx;
  border-radius: 28rpx;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.14);
  font-size: 22rpx;
  color: #1989fa;
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
