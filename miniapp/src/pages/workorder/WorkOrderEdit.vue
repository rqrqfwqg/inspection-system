<template>
  <view class="page">
    <view class="card">
      <view class="fld">
        <text class="lbl">工单标题<text class="req">*</text></text>
        <input class="inp" placeholder="如：南区日常巡查" placeholder-class="ph" v-model="form.title" />
      </view>

      <view class="fld">
        <text class="lbl">工单类型</text>
        <view class="chips">
          <view
            class="chip"
            v-for="t in TYPES"
            :key="t.key"
            :class="{ active: form.type === t.key }"
            @tap="form.type = t.key"
          >{{ t.label }}</view>
        </view>
      </view>

      <view class="fld">
        <text class="lbl">优先级</text>
        <view class="chips">
          <view
            class="chip"
            v-for="p in PRIOS"
            :key="p.key"
            :class="{ active: form.priority === p.key }"
            @tap="form.priority = p.key"
          >{{ p.label }}</view>
        </view>
      </view>

      <view class="fld">
        <text class="lbl">截止时间（逾期判定依据）</text>
        <view class="picker">
          <picker mode="date" :value="date" @change="onDate">
            <view class="pk-val">{{ date || '选择日期' }}</view>
          </picker>
          <picker mode="time" :value="time" @change="onTime">
            <view class="pk-val">{{ time || '选择时间' }}</view>
          </picker>
        </view>
        <text class="hint">未设置截止时间则不会计入「逾期提醒」</text>
      </view>

      <view class="fld">
        <text class="lbl">巡查线路（挂线路后才能打卡）</text>
        <view class="picker">
          <picker :range="routeLabels" :value="routeIdx" @change="onRoute">
            <view class="pk-val">{{ routeLabels[routeIdx] || '不挂线路（仅执行任务）' }}</view>
          </picker>
        </view>
        <text class="hint">线路存于工单 meta.route_id，不改表结构</text>
      </view>

      <view class="fld col">
        <text class="lbl">描述</text>
        <textarea
          class="ta"
          placeholder="补充说明（选填）"
          placeholder-class="ph"
          v-model="form.description"
        />
      </view>
    </view>

    <view class="action-bar">
      <button class="ab-btn" @tap="submit">保存</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createWorkOrder, updateWorkOrder, getWorkOrder, listRoutes } from '@/api/patrol'
import type { RouteItem, WorkOrder } from '@/api/patrol'
import { showToast } from '@/utils/feedback'

const TYPES = [
  { key: 'preventive', label: '预防性巡查' },
  { key: 'corrective', label: '故障维修' },
  { key: 'other', label: '其他' },
]
const PRIOS = [
  { key: 'low', label: '低' },
  { key: 'medium', label: '中' },
  { key: 'high', label: '高' },
  { key: 'urgent', label: '紧急' },
]

const id = ref(0)
const isEdit = ref(false)
const wo = ref<WorkOrder | null>(null)
const routes = ref<RouteItem[]>([])
const routeLabels = ref<string[]>(['不挂线路（仅执行任务）'])
const routeIdx = ref(0)
const date = ref('')
const time = ref('')

const form = reactive({
  title: '',
  type: 'preventive',
  priority: 'medium',
  description: '',
})

function onDate(e: any) {
  date.value = e.detail.value
}
function onTime(e: any) {
  time.value = e.detail.value
}
function onRoute(e: any) {
  routeIdx.value = Number(e.detail.value) || 0
}

function loadRoutes() {
  listRoutes({ status: 'active' })
    .then((rs) => {
      routes.value = rs || []
      routeLabels.value = ['不挂线路（仅执行任务）'].concat(routes.value.map((r) => `${r.name}（${r.node_count} 节点）`))
    })
    .catch(() => (routes.value = []))
}

onLoad((opt) => {
  id.value = Number(opt?.id) || 0
  isEdit.value = id.value > 0
  loadRoutes()
  if (isEdit.value) {
    getWorkOrder(id.value)
      .then((w) => {
        wo.value = w
        form.title = w.title || ''
        form.type = w.type || 'preventive'
        form.priority = w.priority || 'medium'
        form.description = w.description || ''
        if (w.due_at) {
          const s = String(w.due_at)
          date.value = s.slice(0, 10)
          time.value = s.slice(11, 16)
        }
        const rid = w.meta?.route_id ? Number(w.meta.route_id) : null
        if (rid) {
          const i = routes.value.findIndex((r) => r.id === rid)
          if (i >= 0) routeIdx.value = i + 1
        }
      })
      .catch(() => showToast('加载失败', 'none'))
  }
})

function submit() {
  const title = form.title.trim()
  if (!title) {
    showToast('请填写工单标题', 'none')
    return
  }
  // 后端存 UTC：本地选的时间按北京时间 → 转 UTC 字符串（减 8h）
  let due_at: string | null = null
  if (date.value) {
    const t = time.value || '18:00'
    const local = new Date(`${date.value}T${t}:00`)
    if (!isNaN(local.getTime())) due_at = local.toISOString().slice(0, 19)
  }
  const meta: Record<string, any> = {}
  if (routeIdx.value > 0 && routes.value[routeIdx.value - 1]) {
    meta.route_id = routes.value[routeIdx.value - 1].id
  }

  const payload: any = {
    title,
    type: form.type,
    priority: form.priority,
    description: form.description.trim(),
    due_at,
    meta,
  }

  if (isEdit.value) {
    payload.version = wo.value?.version
    updateWorkOrder(id.value, payload)
      .then(() => {
        showToast('已保存', 'success')
        setTimeout(() => uni.navigateBack(), 600)
      })
      .catch((e) => {
        const err = e as any
        if (err?.statusCode === 409) {
          uni.showModal({
            title: '版本冲突',
            content: '工单已被他人修改，是否返回刷新？',
            success: (r) => {
              if (r.confirm) uni.navigateBack()
            },
          })
          return
        }
        showToast(err?.message || '保存失败', 'none')
      })
    return
  }

  createWorkOrder(payload)
    .then(() => {
      showToast('工单已创建（待派发）', 'success')
      setTimeout(() => uni.navigateBack(), 600)
    })
    .catch((e) => showToast((e as any)?.message || '创建失败', 'none'))
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 140rpx);
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  box-shadow: $tm-shadow-card;
}
.fld {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.fld.col { flex-direction: column; align-items: stretch; }
.fld:last-child { border-bottom: none; }
.lbl {
  width: 220rpx;
  flex-shrink: 0;
  font-size: 26rpx;
  color: $tm-text-secondary;
}
.req { color: $tm-danger; }
.inp {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: $tm-text;
}
.ph { color: $tm-text-muted; }
.chips {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
}
.chip {
  margin: 0 10rpx 6rpx 0;
  padding: 10rpx 22rpx;
  font-size: 24rpx;
  color: $tm-text-secondary;
  background: $tm-bg;
  border-radius: 24rpx;
}
.chip.active {
  color: #fff;
  background: $tm-primary;
}
.picker {
  flex: 1;
  display: flex;
}
.pk-val {
  flex: 1;
  font-size: 26rpx;
  color: $tm-text;
}
.hint {
  display: block;
  width: 100%;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.ta {
  width: 100%;
  height: 160rpx;
  margin-top: 12rpx;
  padding: 16rpx;
  font-size: 26rpx;
  background: $tm-bg;
  border-radius: 12rpx;
}
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16rpx 24rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background: $tm-card-bg;
}
.ab-btn {
  height: 88rpx;
  line-height: 88rpx;
  font-size: 30rpx;
  color: #fff;
  background: $tm-primary;
  border-radius: 44rpx;
}
</style>