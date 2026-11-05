<script setup lang="ts">
import { nextTick, reactive, ref } from 'vue'
import { chatStream, type AgentEvent } from '@/api/agent'

interface UiTool {
  name: string
  ok?: boolean
}
interface UiMessage {
  role: 'user' | 'assistant'
  content: string
  tools: UiTool[]
  error?: string
}

const open = ref(false)
const input = ref('')
const loading = ref(false)
const streaming = ref(false)
const messages = ref<UiMessage[]>([])
const listEl = ref<HTMLElement | null>(null)
const sessionId = ref<string | null>(null)
let abort: AbortController | null = null

function toggle() {
  open.value = !open.value
  if (open.value) scrollToBottom()
}

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  })
}

function onEvent(e: AgentEvent, assistant: UiMessage) {
  if (e.type === 'start') {
    if (e.session_id) sessionId.value = e.session_id
  } else if (e.type === 'tool_start') {
    assistant.tools.push({ name: e.name || 'tool' })
    streaming.value = true
  } else if (e.type === 'tool_end') {
    const target = [...assistant.tools]
      .reverse()
      .find((t) => t.name === (e.name || 'tool') && t.ok === undefined)
    if (target) target.ok = e.ok
  } else if (e.type === 'delta') {
    assistant.content += e.content || ''
    streaming.value = true
  } else if (e.type === 'error') {
    assistant.error = e.detail || e.code || '未知错误'
  }
  scrollToBottom()
}

async function send() {
  const text = input.value.trim()
  if (!text || loading.value) return

  // history 只带之前已完成的对话，当前这句由后端追加
  const history = messages.value
    .filter((m) => m.content.trim() && !m.error)
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content }))

  messages.value.push({ role: 'user', content: text, tools: [] })
  // 必须用 reactive 包装：push 之后修改原始对象不会触发视图更新
  const assistant = reactive<UiMessage>({ role: 'assistant', content: '', tools: [] })
  messages.value.push(assistant)

  input.value = ''
  loading.value = true
  streaming.value = false
  abort = new AbortController()

  try {
    await chatStream(
      { message: text, session_id: sessionId.value, history },
      (e) => onEvent(e, assistant),
      abort.signal,
    )
  } catch (err) {
    assistant.error = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
    streaming.value = false
    if (!assistant.content && !assistant.error) assistant.content = '（无返回内容）'
    scrollToBottom()
  }
}

function stop() {
  abort?.abort()
  loading.value = false
  streaming.value = false
}
</script>

<template>
  <div class="gtc-agent">
    <button class="fab" :class="{ 'fab--open': open }" :title="open ? '收起' : '问 GTC-Ops'" @click="toggle">
      {{ open ? '×' : 'AI' }}
    </button>

    <aside v-if="open" class="panel">
      <header class="panel__head">
        <div>
          <div class="panel__title">GTC-Ops · 运维助理</div>
          <div class="panel__sub">资产台账｜治理诊断｜工单巡检</div>
        </div>
        <button class="panel__close" title="收起" @click="toggle">×</button>
      </header>

      <div ref="listEl" class="panel__list">
        <div v-if="!messages.length" class="empty">
          <p>可以直接问：</p>
          <ul>
            <li @click="input = '现在系统里一共有多少台设备？总资产多少钱？'">
              现在系统里一共有多少台设备？总资产多少钱？
            </li>
            <li @click="input = '台账治理现在什么水平？哪些设备没关联？'">
              台账治理现在什么水平？哪些设备没关联？
            </li>
            <li @click="input = '帮我查一下 GW1F-PDF-102-1 是什么设备'">
              帮我查一下 GW1F-PDF-102-1 是什么设备
            </li>
          </ul>
        </div>

        <div v-for="(m, i) in messages" :key="i" class="msg" :class="`msg--${m.role}`">
          <div class="bubble">
            <div v-if="m.tools.length" class="tools">
              <span
                v-for="(t, j) in m.tools"
                :key="j"
                class="chip"
                :class="{ 'chip--bad': t.ok === false, 'chip--pending': t.ok === undefined }"
              >
                {{ t.name }}{{ t.ok === undefined ? ' …' : t.ok ? ' ✓' : ' ✕' }}
              </span>
            </div>
            <div v-if="m.content" class="text">{{ m.content }}</div>
            <div v-if="m.error" class="err">⚠️ {{ m.error }}</div>
            <div v-if="m.role === 'assistant' && loading && !m.content && !m.tools.length" class="thinking">
              思考中…
            </div>
          </div>
        </div>
      </div>

      <footer class="panel__foot">
        <textarea
          v-model="input"
          rows="2"
          placeholder="问运维问题，Enter 发送 / Shift+Enter 换行"
          @keydown.enter.exact.prevent="send"
        />
        <div class="panel__actions">
          <button v-if="loading" class="btn btn--ghost" @click="stop">停止</button>
          <button class="btn btn--primary" :disabled="loading || !input.trim()" @click="send">发送</button>
        </div>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.gtc-agent {
  position: relative;
  z-index: 2000;
}
.fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  background: #2563eb;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.35);
  transition: transform 0.15s ease;
}
.fab:hover {
  transform: translateY(-2px);
}
.fab--open {
  background: #475569;
  box-shadow: 0 8px 20px rgba(71, 85, 105, 0.3);
}

.panel {
  position: fixed;
  right: 24px;
  bottom: 88px;
  width: 420px;
  max-width: calc(100vw - 32px);
  height: 560px;
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  background: var(--panel-bg, #fff);
  color: var(--text, #1f2328);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}

.panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border, #eef0f3);
}
.panel__title {
  font-weight: 650;
  font-size: 14px;
}
.panel__sub {
  font-size: 11px;
  color: var(--text-dim, #6b7280);
  margin-top: 2px;
}
.panel__close {
  border: none;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--text-dim, #6b7280);
}

.panel__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  background: var(--bg, #f7f8fa);
}

.empty {
  font-size: 12px;
  color: var(--text-dim, #6b7280);
}
.empty ul {
  margin: 8px 0 0;
  padding-left: 0;
  list-style: none;
}
.empty li {
  padding: 8px 10px;
  margin-bottom: 6px;
  background: #fff;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  cursor: pointer;
  line-height: 1.5;
}
.empty li:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.msg {
  display: flex;
  margin-bottom: 10px;
}
.msg--user {
  justify-content: flex-end;
}
.bubble {
  max-width: 86%;
  padding: 9px 11px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid var(--border, #eef0f3);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg--user .bubble {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.chip {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
  border: 1px solid #e0e7ff;
}
.chip--pending {
  opacity: 0.75;
}
.chip--bad {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fecaca;
}

.err {
  color: #b91c1c;
  font-size: 12px;
  margin-top: 4px;
}
.thinking {
  color: var(--text-dim, #6b7280);
  font-size: 12px;
}

.panel__foot {
  border-top: 1px solid var(--border, #eef0f3);
  padding: 10px 12px;
  background: #fff;
}
.panel__foot textarea {
  width: 100%;
  resize: none;
  box-sizing: border-box;
  border: 1px solid var(--border, #d1d5db);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
  outline: none;
}
.panel__foot textarea:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}
.panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.btn {
  border-radius: 7px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn--primary {
  background: #2563eb;
  color: #fff;
}
.btn--primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}
.btn--ghost {
  background: #fff;
  border-color: var(--border, #d1d5db);
  color: var(--text-dim, #6b7280);
}
</style>
