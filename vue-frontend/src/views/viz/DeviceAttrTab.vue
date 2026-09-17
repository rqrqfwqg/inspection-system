<script setup lang="ts">
/**
 * 设备属性 Tab（/asset-viz?tab=attr）
 * 「搜索 + 树」两条入口抵达任意对象，右侧整页展示属性与全部关联（不弹抽屉，便于逐跳下钻）。
 *
 * 与「设备层级 / 检索」的区别：
 *  搜索走 `/asset-ledger/resolve`（后端权威匹配内核），**同时**能命中已登记设备与资料域编号
 *  （电柜 `G-…` / 配电箱 / 图纸回路）——后者是整条供电链的入口。
 */
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Connection, Loading, Search } from '@element-plus/icons-vue'
import DeviceAttrPanel from '@/components/viz/DeviceAttrPanel.vue'
import RelTree from '@/components/common/RelTree.vue'
import { getDeviceTree } from '@/api/assetViz'
import { resolveLedger } from '@/api/search'
import type { LedgerResolveCandidate, RelNode } from '@/types/assetViz'

const selected = ref<string | null>(null)

const q = ref('')
const hits = ref<LedgerResolveCandidate[]>([])
const hint = ref('')
const searching = ref(false)

let timer = 0
let seq = 0

watch(q, (v) => {
  const kw = v.trim()
  window.clearTimeout(timer)
  if (kw.length < 2) {
    seq += 1
    hits.value = []
    hint.value = ''
    searching.value = false
    return
  }
  searching.value = true
  timer = window.setTimeout(async () => {
    const my = ++seq
    try {
      const r = await resolveLedger(kw)
      if (my !== seq) return
      hits.value = r.candidates ?? []
      hint.value = hits.value.length === 0 ? '未命中任何编号（可试完整的机身编码或电柜编号）。' : ''
    } catch {
      if (my !== seq) return
      hits.value = []
      hint.value = '检索失败，请稍后重试。'
    } finally {
      if (my === seq) searching.value = false
    }
  }, 320)
})

function loader(parent?: string): Promise<RelNode[]> {
  return getDeviceTree(parent)
}

/** 只有「按子系统分组」的入口节点点击才展开；主设备点击即选中（在右栏看关联） */
function expandOnClick(node: RelNode): boolean {
  return node.meta?.is_group === true
}

function onSelect(node: RelNode) {
  if (node.type === 'device' && node.meta?.is_group !== true) {
    selected.value = String(node.meta?.device_code ?? '')
  }
}

function onLoadError(msg: string) {
  ElMessage({ type: 'error', message: msg, duration: 3000 })
}

function hitMeta(c: LedgerResolveCandidate): string {
  return [c.name || c.asset_name, c.location].filter(Boolean).join(' · ') || '—'
}
</script>

<template>
  <div class="dtab">
    <div class="dtab__left">
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title dtab__title">
            <el-icon :size="16"><Search /></el-icon>
            <span>按编号搜索</span>
          </h3>
        </header>
        <el-input
          v-model="q"
          clearable
          placeholder="机身编码 / 资产号 / 电柜编号…"
        >
          <template #suffix>
            <el-icon v-if="searching" class="is-loading dtab__spin"><Loading /></el-icon>
          </template>
        </el-input>

        <p v-if="hint" class="dtab__hint">{{ hint }}</p>

        <ul v-if="hits.length > 0" class="dtab__hits">
          <li v-for="c in hits" :key="c.device_code">
            <button
              type="button"
              class="dtab__hit"
              :class="{ 'dtab__hit--on': selected === c.device_code }"
              @click="selected = c.device_code"
            >
              <span class="dtab__hit-row">
                <span class="dtab__hit-code mono ellipsis" :title="c.device_code">{{ c.device_code }}</span>
                <el-tag size="small" :type="c.in_devices ? 'primary' : 'warning'" effect="light">
                  {{ c.in_devices ? '已登记' : '仅资料' }}
                </el-tag>
                <span class="dtab__hit-conf tnum">{{ c.confidence }}</span>
              </span>
              <span class="dtab__hit-meta ellipsis" :title="hitMeta(c)">{{ hitMeta(c) }}</span>
            </button>
          </li>
        </ul>

        <p class="dtab__note">
          匹配走台账权威内核：会从品牌型号里反解机身号，所以设备编号与它的上级电柜编号都能搜到。
        </p>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title dtab__title">
            <el-icon :size="16"><Connection /></el-icon>
            <span>设备层级树</span>
          </h3>
        </header>
        <RelTree
          :loader="loader"
          :selected-key="selected ?? ''"
          :mono-types="['device']"
          empty-text="暂无设备层级数据。"
          :expand-on-click="expandOnClick"
          @select="onSelect"
          @load-error="onLoadError"
        />
        <p class="dtab__note">
          层级为 子系统 → 设备类型（同名聚合）→ 主设备 → 配件 / 子设备；点分组展开，点设备在右侧查看属性与关联。
        </p>
      </section>
    </div>

    <div class="dtab__right">
      <DeviceAttrPanel :code="selected" @navigate="selected = $event" />
    </div>
  </div>
</template>

<style scoped>
.dtab {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--space-4);
  align-items: start;
  min-width: 0;
}

.dtab__left,
.dtab__right {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.dtab__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.dtab__spin {
  color: var(--muted);
}

.dtab__hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.dtab__hits {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  max-height: 16rem;
  overflow-y: auto;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.dtab__hits > li + li {
  border-top: 1px solid var(--border-soft);
}

.dtab__hit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.dtab__hit:hover {
  background: var(--surface-2);
}

.dtab__hit--on {
  background: var(--accent-soft);
}

.dtab__hit-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.dtab__hit-code {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--fg);
}

.dtab__hit-conf {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.dtab__hit-meta {
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.dtab__note {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-body);
  color: var(--muted);
}

@media (max-width: 1279px) {
  .dtab {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
