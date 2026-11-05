<template>
  <view class="page">
    <view class="card" v-if="wo">
      <!-- 头部 -->
      <view class="hd">
        <text class="code">{{ wo.code }}</text>
        <view class="tags">
          <text class="tag over" v-if="overdue">已逾期</text>
          <text class="tag st" :style="{ background: colorOf(wo.status) }">{{ labelOf(wo.status) }}</text>
        </view>
      </view>
      <view class="title">{{ wo.title }}</view>
      <view class="desc" v-if="wo.description">{{ wo.description }}</view>

      <view class="meta-grid">
        <view class="mi"><text class="ml">优先级</text><text class="mv">{{ prioLabel(wo.priority) }}</text></view>
        <view class="mi"><text class="ml">类型</text><text class="mv">{{ typeLabel(wo.type) }}</text></view>
        <view class="mi"><text class="ml">创建人</text><text class="mv">#{{ wo.reporter_id }}</text></view>
        <view class="mi"><text class="ml">执行人</text><text class="mv">{{ wo.assignee_id ? '#' + wo.assignee_id : '未指派' }}</text></view>
        <view class="mi col"><text class="ml">截止时间</text><text class="mv" :class="{ late: overdue }">{{ fmtTime(wo.due_at) || '未设置' }}</text></view>
        <view class="mi col"><text class="ml">创建时间</text><text class="mv">{{ fmtTime(wo.created_at) }}</text></view>
      </view>
    </view>

    <!-- 抢单横幅（pending_dispatch 时置顶提示「先接单才能执行」） -->
    <view class="claim-banner" v-if="showClaimBanner">
      <view class="cb-main">
        <text class="cb-t">待接单工单</text>
        <text class="cb-d">{{ claimHint }}</text>
      </view>
      <button class="cb-btn" :class="{ disabled: claimedBy }" @tap="onClaim">
        {{ claimedBy ? '已被接走' : '抢单' }}
      </button>
    </view>

    <!-- 巡查路线地图（线路节点 + 实际打卡轨迹） -->
    <block v-if="hasRoute">
      <view class="sec-title">
        巡查路线
        <text class="cnt" v-if="track.points.length">（已走 {{ fmtDistance(track.distanceM) }}）</text>
      </view>
      <view class="card">
        <MiniMap
          :markers="routeMarkers"
          :polyline="routePolyline"
          :circles="routeCircles"
          :focus-point="mapCenter"
          :focus-label="'看打卡点'"
          :height="420"
          empty-title="该线路暂无地图数据"
          :empty-desc="routeEmptyDesc"
        />
        <view class="track-meta" v-if="track.total > 0 || nodeLocatedCount > 0">
          <view class="tm-row">
            <text class="tm-k">打卡轨迹</text>
            <text class="tm-v">{{ track.located }}/{{ track.total }} 次打卡有坐标</text>
          </view>
          <view class="tm-row" v-if="track.distanceM > 0">
            <text class="tm-k">轨迹里程</text>
            <text class="tm-v">{{ fmtDistance(track.distanceM) }}</text>
          </view>
          <view class="tm-row" v-if="nodeTotal > 0">
            <text class="tm-k">线路节点</text>
            <text class="tm-v">{{ nodeLocatedCount }}/{{ nodeTotal }} 个已定位</text>
          </view>
          <view class="tm-legend">
            <text class="lg lg-ok">● 正常打卡</text>
            <text class="lg lg-oor">● 超范围</text>
            <text class="lg lg-me">● 我的位置</text>
          </view>
        </view>
        <view class="track-note">
          <text v-if="isDone && track.points.length">本工单已完成，点地图左下角「看打卡点」可定位到实际打卡位置。</text>
          连线为按打卡先后顺序连成的实际行走轨迹；圆点是线路节点位置。
          节点位置由该节点所在房间的历史扫码坐标反推，因此精度取决于定位质量
          （室内误差通常几十至上百米），仅供现场参考。
        </view>
      </view>
    </block>

    <!-- 线路打卡区块 -->
    <block v-if="hasRoute">
      <view class="sec-title">
        线路节点打卡
        <text class="cnt" v-if="nodes.length">（{{ progress.done }}/{{ progress.must }} 必打）</text>
      </view>

      <!-- 进度条 -->
      <view class="card">
        <view class="bar"><view class="bar-in" :style="{ width: progressPct + '%' }"></view></view>
        <view class="bar-txt">
          {{ progressPct }}% · 共 {{ nodes.length }} 个节点
          <text class="opt" v-if="optionalCount">（{{ optionalCount }} 个参考点不计入）</text>
        </view>
      </view>

      <!-- 手动定位（打卡位置判定必须以用户手动获取的坐标为准 · 2026-10-23） -->
      <view class="card geo-card">
        <view class="gc-row">
          <view class="gc-info">
            <text class="gc-t">打卡定位</text>
            <text class="gc-d" v-if="manualPoint">
              已获取：{{ manualPoint.latitude.toFixed(6) }}, {{ manualPoint.longitude.toFixed(6) }}
              <text v-if="manualPoint.accuracy" class="gc-acc">（±{{ Math.round(manualPoint.accuracy) }}m）</text>
            </text>
            <text class="gc-d muted" v-else>尚未获取定位，请先手动获取后再打卡</text>
          </view>
          <button class="gc-btn" size="mini" :class="{ busy: geoFetching }" @tap="manualFetch">
            {{ geoFetching ? '定位中…' : (manualPoint ? '重新获取' : '获取当前位置') }}
          </button>
        </view>
        <view class="gc-note">
          位置判定以您手动获取的坐标为准，不使用自动 / 第三方定位。获取后请走近目标房间再打卡；
          若距目标点超出 {{ rangeM }} 米仍允许打卡，但会标记为超范围并提醒您。
        </view>
      </view>

      <!-- 节点列表（任意顺序，可任选先打） -->
      <view class="card">
        <view
          class="node"
          v-for="n in nodes"
          :key="n.id"
          :class="{ done: n.checkin_status === 'done', late: overdue && n.checkin_status !== 'done' }"
        >
          <view class="n-dot">{{ n.checkin_status === 'done' ? '✓' : (n.require_checkin ? '○' : '·') }}</view>
          <view class="n-main">
            <view class="n-name">
              {{ n.snapshot_name || n.room_code || n.area_code || '未命名节点' }}
              <text class="n-opt" v-if="!n.require_checkin">参考点</text>
              <text class="n-oor" v-if="oorNodeIds.includes(n.id)">超范围</text>
            </view>
            <view class="n-meta">
              <text class="n-code">{{ n.room_code || n.area_code }}</text>
              <text class="n-time" v-if="n.checkin_status === 'done'">
                {{ fmtTime(n.checked_at) }} · {{ n.abnormal ? '异常' : '正常' }}
              </text>
              <text class="n-pend" v-else-if="n.require_checkin">{{ overdue ? '已逾期未打卡' : '待打卡' }}</text>
              <text class="n-pend" v-else>无需打卡</text>
            </view>
            <view class="n-remark" v-if="n.remark">备注：{{ n.remark }}</view>
          </view>
          <button
            v-if="n.require_checkin && n.checkin_status !== 'done' && canCheckin"
            class="n-btn"
            size="mini"
            @tap="openCheckin(n)"
          >
            打卡
          </button>
          <text class="n-done-flag" v-else-if="n.checkin_status === 'done'">已打卡</text>
        </view>
        <view class="empty" v-if="!nodes.length">该线路暂无节点</view>
      </view>
    </block>

    <view class="card empty" v-else-if="wo && !hasRoute">该工单未挂巡查线路，仅需执行任务</view>

    <!-- 动作栏 -->
    <view class="action-bar" v-if="wo">
      <button
        class="ab-btn"
        v-for="a in availableActions"
        :key="a.action"
        :class="a.action === 'cancel' ? 'ab-cancel' : 'ab-primary'"
        @tap="runAction(a)"
      >
        {{ a.label }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  getWorkOrder, woNodes, doAction, doCheckin, claimWorkOrder, parseTakenBy,
  isOverdue, routeIdOf,
  WO_STATUS_LABEL, WO_STATUS_COLOR, WO_ACTIONS, WO_CAN_CHECKIN,
  woViewLabel, woViewColor, woViewOf, WO_VIEW,
} from '@/api/patrol'
import type { WorkOrder, WoNode } from '@/api/patrol'
import { workOrderTrack, nodeRoomGeo, fmtDistance, isUsable } from '@/api/geo'
import type { TrackResult, GeoPoint } from '@/api/geo'
import MiniMap from '@/components/MiniMap.vue'
import type { MiniMapMarker, MiniMapCircle } from '@/components/MiniMap.vue'
import { showToast, showInputModal, showModal } from '@/utils/feedback'
import { getCurrentPoint, ensureLocationAuth } from '@/composables/useGeolocation'

const id = ref(0)
const wo = ref<WorkOrder | null>(null)
const nodes = ref<WoNode[]>([])
const loaded = ref(false)

/** 实际打卡轨迹（打卡时上报的坐标连成的折线） */
const track = ref<TrackResult>({ points: [], located: 0, total: 0, distanceM: 0 })
/** 节点所在房间 → 反推坐标 */
const nodeGeo = ref<Map<string, GeoPoint>>(new Map())

/** 抢单占用者姓名：409 后记下来，用于灰显「已被 X 接走」，避免两人白点 */
const takenBy = ref('')
/** 打卡定位中：防重复点击导致同一节点连打 */
const geoPending = ref(false)

/** 打卡范围阈值（米）：超出即记为超范围（产品需求 2026-10-23，与后端 CHECKIN_RADIUS_M 对齐） */
const rangeM = 30
/** 用户手动获取的打卡坐标（必须以用户主动点按获取为准，禁止自动/第三方定位） */
const manualPoint = ref<{ latitude: number; longitude: number; accuracy: number | null } | null>(null)
/** 手动定位进行中 */
const geoFetching = ref(false)
/** 本次会话内被标记为超范围打卡的节点 id（用于列表红标；进入页面时清空） */
const oorNodeIds = ref<number[]>([])

const hasRoute = computed(() => routeIdOf(wo.value) != null)
const overdue = computed(() => isOverdue(wo.value))
const canCheckin = computed(() => !!wo.value && WO_CAN_CHECKIN.includes(wo.value.status as string))

/** 待派工单才显示抢单横幅；已被别人接走则按钮置灰 */
const showClaimBanner = computed(
  () => !!wo.value && wo.value.status === 'pending_dispatch' && !wo.value.assignee_id,
)
const claimedBy = computed(() => !!wo.value?.assignee_id || !!takenBy.value)
const claimHint = computed(() =>
  takenBy.value
    ? `已被 ${takenBy.value} 接走，如需转派请联系调度`
    : '谁先抢到就是谁的，接单后即可开始执行',
)

// 🔴 头部状态徽标走**前台三档**（用户口径：待接单/进行中/已完成）；
// WO_STATUS_LABEL 仅保留给详情里的流转日志等需要精确后台态的场景。
function labelOf(s: string) { return woViewLabel(s) }
function colorOf(s: string) { return woViewColor(s) }
function prioLabel(p?: string) {
  return ({ low: '低', medium: '中', high: '高', urgent: '紧急' } as Record<string, string>)[p || ''] || p || '中'
}
function typeLabel(t?: string) {
  return ({ preventive: '预防性巡查', corrective: '故障维修', other: '其他' } as Record<string, string>)[t || ''] || t || '其他'
}
/** 后端返回裸 UTC（无 Z），按北京时间显示（沿用项目约定：补 Z 再转 +8） */
function fmtTime(s?: string | null) {
  if (!s) return ''
  let t = String(s)
  if (!/[Zz]$/.test(t)) t += 'Z'
  const d = new Date(t)
  if (isNaN(d.getTime())) return String(s).slice(0, 16)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

const mustNodes = computed(() => nodes.value.filter((n) => n.require_checkin !== false))
const optionalCount = computed(() => nodes.value.length - mustNodes.value.length)
const progress = computed(() => ({
  done: mustNodes.value.filter((n) => n.checkin_status === 'done').length,
  must: mustNodes.value.length,
}))
const progressPct = computed(() => {
  const { done, must } = progress.value
  if (!must) return 0
  return Math.round((done / must) * 100)
})

// ===== 巡查路线地图 =====

/**
 * 前台档位是否「已完成」（已完成 / 待验收 / 已闭环）。
 * 这三态都是**回看**场景：人不一定还在现场，地图应以历史打卡位置为主。
 */
const isDone = computed(() => (wo.value ? woViewOf(wo.value.status) === WO_VIEW.DONE : false))

/**
 * 「看打卡点」按钮的目标坐标（已完成工单专用）。
 *
 * 注意：地图**默认仍落在本机位置**（用户 2026-11-05 口径：打开就要看到自己），
 * 这里只作为左下角按钮的跳转目标，不再抢默认视野。
 * 打卡点一个坐标都没有时返回 null，按钮退化为跳到第一个线路节点。
 */
const mapCenter = computed<{ latitude: number; longitude: number } | null>(() => {
  if (!isDone.value) return null
  const pts = track.value.points
  if (!pts.length) return null
  let lat = 0
  let lng = 0
  pts.forEach((p) => {
    lat += p.latitude
    lng += p.longitude
  })
  return { latitude: lat / pts.length, longitude: lng / pts.length }
})

/** 有房间编号的节点总数（area 型节点无房间，无法反推坐标） */
const nodeTotal = computed(() =>
  nodes.value.filter((n) => !!(n.room_code || '').trim()).length,
)

/** 能反推出坐标的节点数 */
const nodeLocatedCount = computed(() => {
  let n = 0
  nodes.value.forEach((nd) => {
    const rc = (nd.room_code || '').trim()
    if (rc && nodeGeo.value.has(rc)) n++
  })
  return n
})

/**
 * 节点打点：已打卡用实心 callout 标序号，未打卡用普通点。
 * 未定位的房间**不打点** —— 宁可少几个点，也不要编一个位置出来。
 */
const routeMarkers = computed<MiniMapMarker[]>(() => {
  const out: MiniMapMarker[] = []
  nodes.value.forEach((n) => {
    const rc = (n.room_code || '').trim()
    if (!rc) return
    const p = nodeGeo.value.get(rc)
    if (!p || !isUsable(p.latitude, p.longitude)) return
    const done = n.checkin_status === 'done'
    const seq = (n.seq ?? 0) + 1
    out.push({
      id: n.id,
      latitude: p.latitude,
      longitude: p.longitude,
      title: `${seq}. ${n.snapshot_name || rc}`,
      label: String(seq),
      alwaysShow: true,
      width: done ? 26 : 20,
      height: done ? 26 : 20,
      opacity: done ? 1 : 0.6,
      // 🔴 序号用 callout 常显（微信 map 的 label 渲染极弱/不显示，之前看不见序号）；
      // 绿色=已打卡，蓝色=未打卡，让 1、2、3、4 清清楚楚钉在每个打卡点上
      callout: {
        display: 'ALWAYS',
        content: String(seq),
        color: '#ffffff',
        bgColor: done ? '#07c160' : '#1989fa',
        fontSize: 12,
        borderRadius: 12,
        padding: 4,
        textAlign: 'center',
      },
    })
  })
  // 轨迹点（实际打卡点）标出来：超范围红、正常绿，与节点（房间反推）位置可能不同
  track.value.points.forEach((p, i) => {
    const oor = !!p.out_of_range
    out.push({
      id: 5000 + i,
      latitude: p.latitude,
      longitude: p.longitude,
      title: `打卡点${i + 1}${oor ? '（超范围）' : ''}`,
      width: oor ? 16 : 14,
      height: oor ? 16 : 14,
      opacity: 1,
      // 🔴 超范围红气泡常显（一眼可见）；正常绿气泡点开看，避免与节点序号气泡挤占
      callout: oor
        ? {
            display: 'ALWAYS',
            content: '超范围',
            color: '#ffffff',
            bgColor: '#ee0a24',
            fontSize: 11,
            borderRadius: 10,
            padding: 3,
            textAlign: 'center',
          }
        : {
            display: 'BYCLICK',
            content: `打卡${i + 1}`,
            color: '#ffffff',
            bgColor: '#07c160',
            fontSize: 11,
            borderRadius: 10,
            padding: 3,
            textAlign: 'center',
          },
    })
  })

  // 我的当前位置（用户手动获取的坐标，作为现场参照；非自动定位，符合 2026-10-23 禁止自动定位的约束）
  if (manualPoint.value && isUsable(manualPoint.value.latitude, manualPoint.value.longitude)) {
    out.push({
      id: 9000,
      latitude: manualPoint.value.latitude,
      longitude: manualPoint.value.longitude,
      title: '我的位置',
      width: 18,
      height: 18,
      alwaysShow: true,
      callout: {
        display: 'ALWAYS',
        content: '我的位置',
        color: '#ffffff',
        bgColor: '#1989fa',
        fontSize: 11,
        borderRadius: 10,
        padding: 3,
        textAlign: 'center',
      },
    })
  }
  return out
})

/** 实际轨迹折线 */
const routePolyline = computed(() =>
  track.value.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
)

/** 节点误差圆（精度不可信时不画，宁可不画也别画个误导人的大圈） */
const routeCircles = computed<MiniMapCircle[]>(() => {
  const out: MiniMapCircle[] = []
  nodes.value.forEach((n) => {
    const rc = (n.room_code || '').trim()
    if (!rc) return
    const p = nodeGeo.value.get(rc)
    if (!p || !isUsable(p.latitude, p.longitude)) return
    const r = Number(p.accuracy || 0)
    if (!(r > 0) || r > 400) return
    out.push({
      id: n.id,
      latitude: p.latitude,
      longitude: p.longitude,
      radius: r,
      color: 'rgba(7,193,96,0.4)',
      fillColor: 'rgba(7,193,96,0.1)',
    })
  })
  return out
})

const routeEmptyDesc = computed(() => {
  if (!nodes.value.length) return '该线路还没有配置节点'
  if (!nodeTotal.value) return '线路节点都是区域类型，缺少房间编号，无法定位到地图上'
  if (!nodeLocatedCount.value) return '这些节点所在房间还没有扫码定位记录，去现场扫一次即可显示'
  if (!track.value.points.length) return '还没有带坐标的打卡记录，完成节点打卡后这里会画出实际轨迹'
  return ''
})

const availableActions = computed(() => {
  if (!wo.value) return []
  const list = WO_ACTIONS[wo.value.status as string] || []
  // claim 已由顶部横幅承担（更醒目且能灰显「已被 X 接走」），底部不重复出
  return list.filter((a) => a.action !== 'claim')
})

function loadAll() {
  if (!id.value) return
  getWorkOrder(id.value)
    .then((w) => {
      wo.value = w
      return woNodes(id.value)
    })
    .then((ns) => {
      nodes.value = ns || []
      loaded.value = true
      // 节点拿到后再去反查坐标（依赖节点的 room_code，不能提前并发）
      return loadTrack()
    })
    .catch((e) => {
      loaded.value = true
      showToast((e as any)?.message || '加载失败', 'none')
    })
}

/**
 * 地图数据（打卡轨迹 + 节点反推坐标）**不阻塞主流程**：
 * 工单主体信息已渲染后才去拉，拉失败只是地图空态，不能让整页报错。
 */
async function loadTrack() {
  try {
    const t = await workOrderTrack(id.value)
    track.value = t
  } catch {
    track.value = { points: [], located: 0, total: 0, distanceM: 0 }
  }
  const codes = nodes.value
    .map((n) => (n.room_code || '').trim())
    .filter(Boolean)
  if (!codes.length) {
    nodeGeo.value = new Map()
    return
  }
  try {
    nodeGeo.value = await nodeRoomGeo(codes)
  } catch {
    nodeGeo.value = new Map()
  }
}

onLoad((opt) => {
  id.value = Number(opt?.id) || 0
  manualPoint.value = null
  oorNodeIds.value = []
})
onShow(() => loadAll())

/** 打开打卡弹层（异常需填说明，故用可输入弹窗） */
function openCheckin(n: WoNode) {
  const name = n.snapshot_name || n.room_code || '该节点'
  uni.showActionSheet({
    itemList: ['正常打卡', '异常（需填写说明）'],
    success: (res) => {
      const abnormal = res.tapIndex === 1
      if (!abnormal) {
        submit(n.id, '', false)
        return
      }
      // content 必须留空：editable 模式下 content 是输入框初值，不是说明文字
      showInputModal({
        title: `${name} 异常说明`,
        placeholderText: '请描述异常情况（必填）',
        confirmText: '提交',
      }).then(({ confirm, content }) => {
        if (!confirm) return
        if (!content || !content.trim()) {
          showToast('异常必须填写说明', 'none')
          return
        }
        submit(n.id, content.trim(), true)
      }).catch(() => {})
    },
    fail: () => {},
  })
}

function submit(nodeId: number, remark: string, abnormal: boolean) {
  if (geoPending.value) return
  // 产品需求 2026-10-23：打卡位置必须以用户**主动点按**获取的坐标为准，禁止自动/第三方定位。
  // 未手动获取定位 → 直接拒绝并提示，绝不在后台静默取位。
  if (!manualPoint.value) {
    showToast('请先手动获取定位（点「获取当前位置」）后再打卡', 'none')
    return
  }
  geoPending.value = true
  const mp = manualPoint.value
  doCheckin(id.value, {
    node_id: nodeId,
    remark,
    abnormal,
    lat: mp.latitude,
    lng: mp.longitude,
  })
    .then((r) => {
      if (r.checkin?.out_of_range) {
        // 超范围仍已正常打卡：标记该节点 + 弹红字即时提醒（产品需求：写入日志 + 提醒通知）
        oorNodeIds.value = [...oorNodeIds.value, nodeId]
        showModal({
          title: '⚠️ 超范围打卡提醒',
          content:
            (r.message || `本次打卡位置超出 ${rangeM} 米打卡范围`) +
            '，本次打卡已正常记录并标记为超范围。',
          showCancel: false,
          confirmText: '我知道了',
        })
      } else {
        showToast(
          r.all_done ? '全部节点已打卡完成' : `已打卡（${r.node_done}/${r.node_total}）`,
          'success',
        )
      }
      loadAll()
    })
    .catch((e) => {
      const err = e as any
      if (err?.statusCode === 409) {
        showToast('该节点已打卡', 'none')
        loadAll()
      } else {
        showToast(err?.message || '打卡失败', 'none')
      }
    })
    .finally(() => {
      geoPending.value = false
    })
}

/**
 * 手动获取当前位置（产品需求 2026-10-23）：
 * 打卡位置必须以用户**主动点按**获取的坐标为准，禁止自动定位或第三方位置数据。
 * - `getCurrentPoint(0)`：强制重新定位，不读 60s 缓存（每次手动取都拿最新解）；
 * - 失败按原因分流提示（拒绝授权 / 隐私未声明 / 超时 / 版本过低）。
 */
async function manualFetch() {
  if (geoFetching.value) return
  geoFetching.value = true
  try {
    const authed = await ensureLocationAuth()
    if (!authed) return // ensureLocationAuth 已引导去设置页
    const res = await getCurrentPoint(0)
    if (res.point) {
      manualPoint.value = {
        latitude: res.point.latitude,
        longitude: res.point.longitude,
        accuracy: res.point.accuracy ?? null,
      }
      showToast('已获取当前位置', 'success')
    } else {
      const reason = res.reason
      const tip =
        reason === 'privacy'
          ? '小程序未声明位置权限，请联系管理员'
          : reason === 'unsupported'
            ? '微信版本过低，请升级微信后重试'
            : reason === 'timeout'
              ? '定位超时，请到信号较好的位置重试'
              : reason === 'denied'
                ? '定位权限未开启，请在设置中开启后重试'
                : '定位失败，请重试'
      showToast(tip, 'none')
    }
  } finally {
    geoFetching.value = false
  }
}

/**
 * 抢单：谁接了就是谁的（全域开放）。
 * -409 = 已被别人接走 → 记下占用者姓名并**灰掉按钮**（避免两人白点）
 * -403 = 权限不足（后端 execute 权限位）
 */
function onClaim() {
  if (!wo.value || claimedBy.value) return
  showModal({
    title: '抢单',
    content: '接单后该工单即归你负责，确认接单？',
    confirmText: '确认接单',
  }).then((ok) => {
    if (!ok) return
    return claimWorkOrder(wo.value!.id, wo.value!.version)
      .then((r) => {
        showToast('接单成功', 'success')
        takenBy.value = ''
        wo.value = r
        loadAll()
      })
      .catch((e) => {
        const err = e as any
        if (err?.statusCode === 409) {
          // 被抢走：从文案里抽出占用者姓名，灰显提示
          const who = parseTakenBy(err?.message || '')
          takenBy.value = who || '他人'
          showToast(`已被${takenBy.value}接走`, 'none')
          loadAll()
        } else if (err?.statusCode === 403) {
          showToast('你当前角色无接单权限，请联系调度派单', 'none')
        } else {
          showToast(err?.message || '接单失败', 'none')
        }
      })
  }).catch(() => {})
}

function runAction(a: { action: string; label: string }) {
  if (a.action === 'cancel') {
    // ⚠️ 后端 CancelRequest.reason 为**必填**（min_length=1，取消必须留原因）。
    //    旧实现只弹「确定取消吗」然后发 {} → 后端直接 400 Bad Request，
    //    表现就是「点取消一直报错」。这里改成必填原因的输入弹窗。
    showInputModal({
      title: '取消工单',
      placeholderText: '请填写取消原因（必填）',
      confirmText: '确认取消',
    })
      .then(({ confirm, content }) => {
        if (!confirm) return
        const reason = (content || '').trim()
        if (!reason) {
          showToast('取消工单必须填写原因', 'none')
          return
        }
        doAct('cancel', { reason })
      })
      .catch(() => {})
    return
  }
  if (a.action === 'claim') {
    onClaim()
    return
  }
  if (a.action === 'dispatch') {
    // 指派（保留调度台能力）：优先派给当前登录人；未登录则退回报错提示
    doAct('dispatch', { assignee_id: wo.value?.reporter_id })
    return
  }
  if (a.action === 'review') {
    uni.showActionSheet({
      itemList: ['验收通过', '打回重做'],
      success: (r) => {
        doAct('review', { approved: r.tapIndex === 0 })
      },
      fail: () => {},
    })
    return
  }
  if (a.action === 'reopen') {
    uni.showActionSheet({
      itemList: ['重开为待执行', '重开为进行中'],
      success: (r) => {
        doAct('reopen', { target_status: r.tapIndex === 0 ? 'assigned' : 'in_progress' })
      },
      fail: () => {},
    })
    return
  }
  doAct(a.action, {})
}

function doAct(action: string, payload: Record<string, any>) {
  doAction(id.value, action, payload)
    .then(() => {
      showToast('操作成功', 'success')
      loadAll()
    })
    .catch((e) => {
      const err = e as any
      if (err?.statusCode === 409) {
        uni.showModal({
          title: '版本冲突',
          content: '工单已被他人修改，是否刷新查看最新状态？',
          success: (r) => {
            if (r.confirm) loadAll()
          },
        })
        return
      }
      showToast(err?.message || '操作失败', 'none')
    })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 160rpx);
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 20rpx;
  box-shadow: $tm-shadow-card;
}
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.code {
  font-size: 24rpx;
  color: $tm-text-muted;
}
.tags {
  display: flex;
}
.tag {
  margin-left: 10rpx;
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  color: #fff;
  border-radius: 20rpx;
}
.tag.over { background: $tm-danger; }
.title {
  margin-top: 12rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: $tm-text;
}
.desc {
  margin-top: 10rpx;
  font-size: 26rpx;
  color: $tm-text-secondary;
  line-height: 1.5;
}
.meta-grid {
  margin-top: 20rpx;
  display: flex;
  flex-wrap: wrap;
}
.mi {
  width: 50%;
  display: flex;
  margin-bottom: 10rpx;
}
.mi.col { width: 100%; }
.ml {
  width: 130rpx;
  font-size: 24rpx;
  color: $tm-text-muted;
}
.mv {
  flex: 1;
  font-size: 24rpx;
  color: $tm-text;
}
.mv.late { color: $tm-danger; }

.sec-title {
  padding: 8rpx 8rpx 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
}
.cnt {
  font-size: 24rpx;
  font-weight: 400;
  color: $tm-text-muted;
}

/* 巡查路线地图 */
.track-meta {
  margin-top: 20rpx;
  padding-top: 8rpx;
  border-top: 1rpx solid $tm-border-light;
}
.tm-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12rpx 0;
}
.tm-k {
  font-size: 25rpx;
  color: $tm-text-secondary;
}
.tm-v {
  font-size: 25rpx;
  color: $tm-text;
}
.track-note {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
  line-height: 1.7;
}
.tm-legend {
  display: flex;
  margin-top: 14rpx;
  padding-top: 12rpx;
  border-top: 1rpx solid $tm-border-light;
}
.lg {
  font-size: 22rpx;
  margin-right: 24rpx;
}
.lg-ok { color: #07c160; }
.lg-oor { color: #ee0a24; }
.lg-me { color: #1989fa; }
.bar {
  height: 16rpx;
  background: $tm-bg;
  border-radius: 8rpx;
  overflow: hidden;
}
.bar-in {
  height: 100%;
  background: $tm-primary;
}
.bar-txt {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: $tm-text-secondary;
}
.opt {
  color: $tm-text-muted;
  font-size: 22rpx;
}
.node {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.node:last-child { border-bottom: none; }
.n-dot {
  width: 56rpx;
  height: 56rpx;
  flex-shrink: 0;
  line-height: 56rpx;
  text-align: center;
  font-size: 30rpx;
  color: $tm-text-muted;
  background: $tm-bg;
  border-radius: 50%;
}
.node.done .n-dot {
  color: #fff;
  background: $tm-success;
}
.n-main {
  flex: 1;
  min-width: 0;
  margin-left: 18rpx;
}
.n-name {
  font-size: 28rpx;
  color: $tm-text;
}
.n-opt {
  margin-left: 10rpx;
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: $tm-text-muted;
  background: $tm-bg;
  border-radius: 8rpx;
}
.n-meta {
  margin-top: 6rpx;
}
.n-code, .n-time, .n-pend {
  font-size: 22rpx;
  color: $tm-text-muted;
  margin-right: 16rpx;
}
.node.done .n-time { color: $tm-success; }
.node.late .n-pend { color: $tm-danger; }
.n-remark {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.n-btn {
  flex-shrink: 0;
  margin-left: 12rpx;
  padding: 0 26rpx;
  height: 60rpx;
  line-height: 60rpx;
  font-size: 24rpx;
  color: #fff;
  background: $tm-primary;
  border-radius: 30rpx;
}
.n-done-flag {
  flex-shrink: 0;
  margin-left: 12rpx;
  font-size: 24rpx;
  color: $tm-success;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 40rpx 0;
}
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  padding: 16rpx 24rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background: $tm-card-bg;
  box-shadow: 0 -4rpx 16rpx rgba(0, 0, 0, 0.06);
}
.ab-btn {
  flex: 1;
  margin: 0 8rpx;
  height: 84rpx;
  line-height: 84rpx;
  font-size: 28rpx;
  border-radius: 42rpx;
}
.ab-primary {
  color: #fff;
  background: $tm-primary;
}
.ab-cancel {
  color: $tm-danger;
  background: $tm-danger-bg;
}

/* ---------- 手动定位卡片（2026-10-23） ---------- */
.geo-card {
  padding: 20rpx 24rpx;
}
.gc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gc-info {
  flex: 1;
  min-width: 0;
  margin-right: 16rpx;
}
.gc-t {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
}
.gc-d {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
  word-break: break-all;
}
.gc-d.muted { color: $tm-text-muted; }
.gc-acc { color: $tm-text-muted; }
.gc-btn {
  flex-shrink: 0;
  padding: 0 26rpx;
  height: 60rpx;
  line-height: 60rpx;
  font-size: 24rpx;
  color: #fff;
  background: $tm-primary;
  border-radius: 30rpx;
}
.gc-btn.busy { opacity: 0.6; }
.gc-btn::after { border: none; }
.gc-note {
  margin-top: 14rpx;
  padding-top: 12rpx;
  border-top: 1rpx solid $tm-border-light;
  font-size: 22rpx;
  color: $tm-text-muted;
  line-height: 1.7;
}

/* 节点超范围红标 */
.n-oor {
  margin-left: 10rpx;
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: #fff;
  background: $tm-danger;
  border-radius: 8rpx;
}

/* ---------- 抢单横幅 ---------- */
.claim-banner {
  display: flex;
  align-items: center;
  background: linear-gradient(135deg, #1989fa, #0a7bf3);
  border-radius: $tm-radius;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 4rpx 16rpx rgba(25, 137, 250, 0.22);
}
.cb-main {
  flex: 1;
  min-width: 0;
}
.cb-t {
  font-size: 30rpx;
  font-weight: 700;
  color: #fff;
  display: block;
}
.cb-d {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.9);
  display: block;
  margin-top: 6rpx;
}
.cb-btn {
  flex-shrink: 0;
  margin-left: 18rpx;
  height: 68rpx;
  line-height: 68rpx;
  padding: 0 36rpx;
  border-radius: 34rpx;
  background: #fff;
  color: $tm-primary;
  font-size: 28rpx;
  font-weight: 700;
  border: none;
}
.cb-btn::after {
  border: none;
}
.cb-btn.disabled {
  background: rgba(255, 255, 255, 0.35);
  color: rgba(255, 255, 255, 0.9);
}
</style>