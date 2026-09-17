<script setup lang="ts">
/**
 * 检索 Tab（/asset-viz?tab=search）
 * 单编号聚合检索：一次取回设备基础信息 / 固定资产 / 设备档案 / BA 问题 / 配件 / 别名 / 关联设备。
 * 未命中时给出明确指引（可确认编号 / 移交编号 / BA编号 / 别名），不静默空白。
 * 注意：`/search` 的**权威契约**在 `@/types/asset`（含 fixed_asset/archive/accessories/aliases/
 * problems/profile 等扩展聚合），而 api/search.ts 的返回声明较窄 —— 与 useVizDeviceBundle 同口径转型。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Box, Files, Link, Loading, PriceTag, Search, Tools } from '@element-plus/icons-vue'
import BaProblemList from '@/components/viz/BaProblemList.vue'
import FieldList from '@/components/viz/FieldList.vue'
import { searchDevice } from '@/api/search'
import { fmtValue } from '@/lib/format'
import type { BaProblem, SearchResult } from '@/types/assetViz'

const emit = defineEmits<{ (e: 'open-device', code: string): void }>()

const code = ref('')
const loading = ref(false)
const result = ref<SearchResult | null>(null)

async function doSearch() {
  const c = code.value.trim()
  if (!c) {
    ElMessage({ type: 'error', message: '请输入设备编号' })
    return
  }
  loading.value = true
  try {
    const res = (await searchDevice(c)) as unknown as SearchResult
    result.value = res
    if (!res.found) {
      ElMessage({
        type: 'error',
        message: '未找到该设备：请确认设备编号 / 移交编号 / BA编号 / 别名是否正确。',
        duration: 4000,
      })
    }
  } catch (e) {
    ElMessage({ type: 'error', message: `检索失败：${e instanceof Error ? e.message : ''}` })
  } finally {
    loading.value = false
  }
}

const currentCode = computed(() =>
  result.value?.target?.device_code ? String(result.value.target.device_code) : code.value.trim(),
)
const targetData = computed(
  () => (result.value?.target ?? null) as unknown as Record<string, unknown> | null,
)
const fixedAsset = computed(() => result.value?.fixed_asset ?? null)
const archive = computed(() => result.value?.archive ?? null)
const accessories = computed(() => result.value?.accessories ?? [])
const aliases = computed(() => result.value?.aliases ?? [])
const baProblems = computed(() => (result.value?.problems ?? []) as unknown as BaProblem[])

/** /search 的 edges 形状是 {from,to,type}，统一成渲染用的对端口径 */
const relEdges = computed(() =>
  (result.value?.edges ?? []).map((e) => ({
    from: String(e.from ?? ''),
    to: String(e.to ?? ''),
    type: String(e.type ?? '关联'),
  })),
)

function aliasText(a: Record<string, unknown>): string {
  return fmtValue(a.alias ?? a)
}
</script>

<template>
  <div class="vsr">
    <section class="panel">
      <div class="vsr__bar">
        <el-input
          v-model="code"
          class="vsr__input"
          placeholder="输入设备编号 / 移交编号 / BA编号 / 别名"
          @keyup.enter="doSearch"
        />
        <el-button type="primary" :disabled="loading" @click="doSearch">
          <el-icon :size="16" :class="{ 'is-loading': loading }">
            <Loading v-if="loading" /><Search v-else />
          </el-icon>
          <span>{{ loading ? '检索中…' : '检索' }}</span>
        </el-button>
      </div>
    </section>

    <el-empty v-if="!result && !loading" description="输入设备编号后点击「检索」" :image-size="96" />

    <section v-else-if="loading" class="panel vsr__loading">
      <el-skeleton :rows="4" animated />
    </section>

    <div v-else class="vsr__result">
      <section class="panel">
        <header class="panel-head vsr__head">
          <h3 class="panel-title vsr__title">
            <el-icon :size="16"><Box /></el-icon>
            <span>设备基础信息</span>
          </h3>
          <el-button size="small" @click="emit('open-device', currentCode)">打开设备详情</el-button>
        </header>
        <FieldList :data="targetData" empty-text="未检索到设备基础信息" />
      </section>

      <div class="vsr__two">
        <section class="panel">
          <header class="panel-head">
            <h3 class="panel-title vsr__title">
              <el-icon :size="16"><Files /></el-icon>
              <span>固定资产</span>
            </h3>
          </header>
          <FieldList :data="fixedAsset" empty-text="无" />
        </section>
        <section class="panel">
          <header class="panel-head">
            <h3 class="panel-title vsr__title">
              <el-icon :size="16"><Files /></el-icon>
              <span>设备档案</span>
            </h3>
          </header>
          <FieldList :data="archive" empty-text="无" />
        </section>
      </div>

      <BaProblemList :problems="baProblems" empty-text="无" />

      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title vsr__title">
            <el-icon :size="16"><Tools /></el-icon>
            <span>配件（{{ accessories.length }}）</span>
          </h3>
        </header>
        <p v-if="accessories.length === 0" class="vsr__none">无</p>
        <div v-else class="vsr__acc">
          <FieldList v-for="(a, i) in accessories" :key="i" :data="a" :columns="2" empty-text="—" />
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title vsr__title">
            <el-icon :size="16"><PriceTag /></el-icon>
            <span>别名（{{ aliases.length }}）</span>
          </h3>
        </header>
        <p v-if="aliases.length === 0" class="vsr__none">无</p>
        <div v-else class="vsr__aliases">
          <el-tag v-for="(a, i) in aliases" :key="i" size="small" type="info" effect="plain">
            {{ aliasText(a) }}
          </el-tag>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title vsr__title">
            <el-icon :size="16"><Link /></el-icon>
            <span>关联设备（{{ relEdges.length }}）</span>
          </h3>
        </header>
        <p v-if="relEdges.length === 0" class="vsr__none">无</p>
        <ul v-else class="vsr__edges">
          <li v-for="(edge, i) in relEdges" :key="i" class="vsr__edge">
            <el-tag size="small" type="info" effect="plain">{{ edge.type }}</el-tag>
            <button
              type="button"
              class="vsr__link mono break-code"
              @click="emit('open-device', edge.from === currentCode ? edge.to : edge.from)"
            >
              {{ edge.from === currentCode ? edge.to : edge.from }}
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.vsr {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.vsr__bar {
  display: flex;
  gap: var(--space-2);
}

.vsr__input {
  flex: 1 1 auto;
  min-width: 0;
}

.vsr__loading {
  min-height: 200px;
}

.vsr__result {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.vsr__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.vsr__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.vsr__two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.vsr__none {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.vsr__acc {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.vsr__aliases {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.vsr__edges {
  list-style: none;
  margin: 0;
  padding: 0;
}

.vsr__edge {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-1) 0;
  border-bottom: 1px dashed var(--border-soft);
  font-size: var(--text-sm);
}

.vsr__link {
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  text-align: left;
}

.vsr__link:hover {
  text-decoration: underline;
}

@media (max-width: 1279px) {
  .vsr__two {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
