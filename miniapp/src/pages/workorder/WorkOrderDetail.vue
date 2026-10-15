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
        </view>
        <view class="track-note">
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
  woViewLabel, woViewColor,
} from '@/api/patrol'
import type { WorkOrder, WoNode } from '@/api/patrol'
import { workOrderTrack, nodeRoomGeo, fmtDistance, isUsable } from '@/api/geo'
import type { TrackResult, GeoPoint } from '@/api/geo'
import MiniMap from '@/components/MiniMap.vue'
import type { MiniMapMarker, MiniMapCircle } from '@/components/MiniMap.vue'
import { showToast, showInputModal, showModal } from '@/utils/feedback'
import { getCurrentPoint } from '@/composables/useGeolocation'

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
    out.push({
      id: n.id,
      latitude: p.latitude,
      longitude: p.longitude,
      title: n.snapshot_name || rc,
      label: String(n.seq || ''),
      alwaysShow: true,
      width: done ? 26 : 20,
      height: done ? 26 : 20,
      opacity: done ? 1 : 0.6,
      callout: {
        display: done ? 'ALWAYS' : 'BYCLICK',
        color: done ? '#07c160' : '#969799',
        fontSize: 11,
        borderRadius: 4,
        bgColor: '#ffffff',
        padding: 3,
      },
    })
  })
  // 轨迹点也标出来（与节点可能不在同一位置：节点是房间反推，轨迹是实际打卡点）
  track.value.points.forEach((p, i) => {
    out.push({
      id: 5000 + i,
      latitude: p.latitude,
      longitude: p.longitude,
      title: '打卡点',
      width: 12,
      height: 12,
      opacity: 0.9,
    })
  })
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
  geoPending.value = true
  // 定位只记录不拦截（强校验二期再开）：**先定位、超时兜底放行，绝不因定位失败挡住打卡**
  withGeo()
    .then((geo) =>
      doCheckin(id.value, {
        node_id: nodeId,
        remark,
        abnormal,
        lat: geo?.latitude ?? null,
        lng: geo?.longitude ?? null,
      }),
    )
    .then((r) => {
      showToast(r.all_done ? '全部节点已打卡完成' : `已打卡（${r.node_done}/${r.node_total}）`, 'success')
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
 * 取当前定位，带超时兜底。
 * ⚠️ 定位失败/超时/用户拒绝一律 resolve(null) —— 打卡**不能**被定位阻塞，
 * 只是这次没有坐标而已（后端 lat/lng 允许 NULL）。
 */
function withGeo(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: { latitude: number; longitude: number } | null) => {
      if (done) return
      done = true
      resolve(v)
    }
    // 兜底 4s：定位慢/无响应时直接放行
    const timer = setTimeout(() => finish(null), 4000)
    getCurrentPoint()
      .then((geo) => {
        clearTimeout(timer)
        finish(geo.point ? { latitude: geo.point.latitude, longitude: geo.point.longitude } : null)
      })
      .catch(() => {
        clearTimeout(timer)
        finish(null)
      })
  })
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
    uni.showModal({
      title: '取消工单',
      content: '确定取消该工单吗？',
      success: (r) => {
        if (r.confirm) doAct('cancel', {})
      },
    })
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