<template>
  <view class="page">
    <scroll-view
      class="list"
      scroll-y
      :scroll-into-view="anchor"
      :scroll-with-animation="true"
    >
      <!-- 空态：给三个可直接点的示例问题 -->
      <view v-if="!msgs.length" class="intro">
        <view class="intro-title">GTC-Ops 运维助理</view>
        <view class="intro-sub">资产台账 · 治理诊断 · 工单巡检</view>
        <view class="sugs">
          <view v-for="(s, i) in suggestions" :key="i" class="sug" @tap="input = s">
            {{ s }}
          </view>
        </view>
      </view>

      <view v-for="(m, i) in msgs" :key="i" class="msg" :class="m.role">
        <view class="bubble">
          <view v-if="m.tools.length" class="chips">
            <text
              v-for="(t, j) in m.tools"
              :key="j"
              class="chip"
              :class="{ bad: t.ok === false }"
            >
              {{ t.tool }}{{ t.ok === false ? ' ✕' : ' ✓' }}
            </text>
          </view>
          <text v-if="m.content" class="txt" selectable>{{ m.content }}</text>
          <text v-if="m.error" class="err">⚠️ {{ m.error }}</text>
        </view>
      </view>

      <view v-if="loading" class="msg assistant">
        <view class="bubble">
          <text class="txt muted">正在查询…</text>
        </view>
      </view>

      <view id="anchor-bottom" class="anchor"></view>
    </scroll-view>

    <view class="inputbar">
      <textarea
        v-model="input"
        class="ta"
        auto-height
        :maxlength="500"
        placeholder="问运维问题，例如：现在有多少台设备？"
        placeholder-class="ph"
        :disabled="loading"
        confirm-type="send"
        @confirm="send"
      />
      <button class="send" :disabled="loading || !input.trim()" @tap="send">发送</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { agentChat, type AgentTrace } from '@/api/agent'

interface UiMsg {
  role: 'user' | 'assistant'
  content: string
  tools: AgentTrace[]
  error?: string
}

const msgs = ref<UiMsg[]>([])
const input = ref('')
const loading = ref(false)
const sessionId = ref<string | null>(null)
const anchor = ref('')

const suggestions = [
  '现在系统里一共有多少台设备？总资产多少钱？',
  '台账治理现在什么水平？哪些设备没关联？',
  '帮我查一下 GW1F-PDF-102-1 是什么设备',
]

function scrollBottom() {
  nextTick(() => {
    anchor.value = ''
    // 先清空再赋值，确保同一锚点也能二次触发滚动
    setTimeout(() => {
      anchor.value = 'anchor-bottom'
    }, 30)
  })
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return

  const history = msgs.value
    .filter((m) => m.content.trim() && !m.error)
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content }))

  msgs.value.push({ role: 'user', content: text, tools: [] })
  input.value = ''
  loading.value = true
  scrollBottom()

  try {
    const res = await agentChat({
      message: text,
      session_id: sessionId.value,
      history,
    })
    if (res.session_id) sessionId.value = res.session_id
    msgs.value.push({
      role: 'assistant',
      content: res.answer || '（无返回内容）',
      tools: res.trace || [],
    })
  } catch (err) {
    const message = (err as { message?: string })?.message || '请求失败'
    msgs.value.push({ role: 'assistant', content: '', tools: [], error: message })
  } finally {
    loading.value = false
    scrollBottom()
  }
}
</script>

<style scoped lang="scss">
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: $tm-bg;
}

.list {
  flex: 1 1 auto;
  min-height: 0;
  padding: 24rpx;
  box-sizing: border-box;
}

/* ── 空态 ── */
.intro {
  padding: 40rpx 8rpx 20rpx;
}
.intro-title {
  font-size: 40rpx;
  font-weight: 700;
  color: $tm-text;
}
.intro-sub {
  margin-top: 8rpx;
  font-size: 26rpx;
  color: $tm-text-secondary;
}
.sugs {
  margin-top: 32rpx;
}
.sug {
  padding: 22rpx 24rpx;
  margin-bottom: 16rpx;
  background: #fff;
  border-radius: 16rpx;
  font-size: 27rpx;
  line-height: 1.55;
  color: $tm-text;
}

/* ── 消息 ── */
.msg {
  display: flex;
  margin-bottom: 20rpx;
}
.msg.user {
  justify-content: flex-end;
}
.bubble {
  max-width: 84%;
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  background: #fff;
  box-sizing: border-box;
}
.msg.user .bubble {
  background: #2563eb;
}
.txt {
  font-size: 28rpx;
  line-height: 1.65;
  color: $tm-text;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.user .txt {
  color: #fff;
}
.muted {
  color: $tm-text-secondary;
}
.err {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #b91c1c;
}

/* 工具调用 chip */
.chips {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 12rpx;
}
.chip {
  padding: 4rpx 14rpx;
  margin: 0 8rpx 8rpx 0;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: #3730a3;
  background: #eef2ff;
}
.chip.bad {
  color: #b91c1c;
  background: #fef2f2;
}

.anchor {
  height: 1rpx;
}

/* ── 输入栏 ── */
.inputbar {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  padding: 16rpx 24rpx calc(env(safe-area-inset-bottom) + 16rpx);
  background: #fff;
  border-top: 1rpx solid #eef0f3;
}
.ta {
  flex: 1 1 auto;
  min-height: 72rpx;
  max-height: 220rpx;
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  line-height: 1.5;
  background: #f7f8fa;
  border-radius: 16rpx;
  box-sizing: border-box;
}
.ph {
  color: #9ca3af;
}
.send {
  flex: 0 0 auto;
  margin-left: 16rpx;
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 32rpx;
  font-size: 28rpx;
  color: #fff;
  background: #2563eb;
  border-radius: 16rpx;
  border: none;
}
.send:disabled,
.send[disabled] {
  background: #9ca3af;
  color: #fff;
}
.send::after {
  border: none;
}
</style>
