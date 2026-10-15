<template>
  <view class="page">
    <view class="card">
      <view class="fld">
        <text class="lbl">线路名称<text class="req">*</text></text>
        <input class="inp" placeholder="如：南区日常巡查线" placeholder-class="ph" v-model="form.name" />
      </view>
      <view class="fld col">
        <text class="lbl">备注</text>
        <textarea class="ta" placeholder="选填" placeholder-class="ph" v-model="form.description" />
      </view>
    </view>

    <view class="sec-title">
      初始节点（选填）
      <text class="hint">（节点可在建好后再扫码添加）</text>
    </view>

    <view class="card">
      <view class="node" v-for="(n, i) in form.nodes" :key="i">
        <text class="seq">{{ i + 1 }}</text>
        <view class="n-main">
          <text class="n-name">{{ n.snapshot_name || n.room_code }}</text>
          <text class="n-code">{{ n.room_code }}</text>
        </view>
        <text class="n-del" @tap="removeNode(i)">移除</text>
      </view>
      <view class="empty" v-if="!form.nodes.length">暂无节点</view>
    </view>

    <view class="action-bar">
      <button class="ab-btn ab-add" @tap="addByPick">添加房间节点</button>
      <button class="ab-btn" @tap="submit">{{ isEdit() ? '保存修改' : '创建线路' }}</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createRoute, updateRoute, getRoute, availableNodes } from '@/api/patrol'
import { showToast, showLoading, hideLoading } from '@/utils/feedback'

const routeId = ref(0)
const saving = ref(false)

const form = reactive({
  name: '',
  description: '',
  nodes: [] as Array<{ node_type: string; room_code: string; snapshot_name: string; require_checkin: boolean }>,
})

const isEdit = () => routeId.value > 0

/** 编辑模式：回填原线路（含节点）；编辑时 nodes 走全量替换 */
function loadForEdit() {
  showLoading('加载中')
  getRoute(routeId.value)
    .then((r) => {
      form.name = r.name || ''
      form.description = r.description || ''
      form.nodes = (r.nodes || []).map((n: any) => ({
        node_type: n.node_type || 'room',
        room_code: n.room_code || n.area_code || '',
        snapshot_name: n.snapshot_name || '',
        require_checkin: n.require_checkin !== false,
      }))
      hideLoading()
    })
    .catch((e) => {
      hideLoading()
      showToast((e as any)?.message || '线路加载失败', 'none')
    })
}

onLoad((opt) => {
  const id = Number((opt as any)?.id || 0)
  if (id) {
    routeId.value = id
    loadForEdit()
  }
})

function addByPick() {
  availableNodes('room')
    .then((list) => {
      if (!list || !list.length) {
        showToast('暂无可选房间', 'none')
        return
      }
      const used = new Set(form.nodes.map((n) => n.room_code))
      const avail = list.filter((r: any) => !used.has(r.room_code)).slice(0, 6)
      if (!avail.length) {
        showToast('已添加的都在列表前6个内', 'none')
        return
      }
      uni.showActionSheet({
        itemList: avail.map((r: any) => `${r.snapshot_name || r.room_code}（${r.room_code}）`),
        success: (res) => {
          const r = avail[res.tapIndex]
          form.nodes.push({
            node_type: 'room',
            room_code: r.room_code,
            snapshot_name: r.snapshot_name || '',
            require_checkin: true,
          })
        },
        fail: () => {},
      })
    })
    .catch(() => showToast('房间列表加载失败', 'none'))
}

function removeNode(i: number) {
  form.nodes.splice(i, 1)
}

function submit() {
  const name = form.name.trim()
  if (!name) {
    showToast('请填写线路名称', 'none')
    return
  }
  if (saving.value) return
  saving.value = true
  const nodes = form.nodes.map((n, i) => ({ ...n, seq: i }))
  const done = () => {
    saving.value = false
    showToast(isEdit() ? '线路已保存' : '线路已创建', 'success')
    setTimeout(() => uni.navigateBack(), 600)
  }
  const fail = (e: any) => {
    saving.value = false
    showToast(e?.message || (isEdit() ? '保存失败' : '创建失败'), 'none')
  }
  if (isEdit()) {
    // 不传 nodes 则后端保持原节点；此处传则是全量替换（与编辑语义一致）
    updateRoute(routeId.value, {
      name,
      description: form.description.trim(),
      nodes,
    })
      .then(done)
      .catch(fail)
  } else {
    createRoute({
      name,
      description: form.description.trim(),
      status: 'active',
      nodes,
    })
      .then(done)
      .catch(fail)
  }
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
.fld {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  padding: 16rpx 0;
}
.fld.col { flex-direction: column; align-items: stretch; }
.lbl {
  width: 200rpx;
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
.ta {
  width: 100%;
  height: 140rpx;
  margin-top: 12rpx;
  padding: 16rpx;
  font-size: 26rpx;
  background: $tm-bg;
  border-radius: 12rpx;
}
.sec-title {
  padding: 8rpx 8rpx 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-text;
}
.hint {
  font-size: 22rpx;
  font-weight: 400;
  color: $tm-text-muted;
}
.node {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  padding: 16rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.node:last-child { border-bottom: none; }
.seq {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
  line-height: 44rpx;
  text-align: center;
  font-size: 22rpx;
  color: $tm-primary;
  background: $tm-primary-bg;
  border-radius: 50%;
}
.n-main {
  flex: 1;
  min-width: 0;
  margin-left: 16rpx;
}
.n-name {
  font-size: 28rpx;
  color: $tm-text;
}
.n-code {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}
.n-del {
  flex-shrink: 0;
  padding: 0 16rpx;
  font-size: 24rpx;
  color: $tm-danger;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
  padding: 30rpx 0;
}
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  padding: 16rpx 24rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background: $tm-card-bg;
}
.ab-btn {
  flex: 1;
  margin: 0 8rpx;
  height: 84rpx;
  line-height: 84rpx;
  font-size: 28rpx;
  border-radius: 42rpx;
}
.ab-add {
  color: $tm-primary;
  background: $tm-primary-bg;
}
</style>