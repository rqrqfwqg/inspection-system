<script setup lang="ts">
/**
 * /ops/qr/:code —— 现场扫码直达页（P0）。
 * 二维码内容 = https://<origin>/ops/qr/<encodeURIComponent(设备编号)>，
 * 编号可为 移交编号/标签号/资产代码/BIM/新编号 任一种：后端 /search 走别名桥接收敛到 canonical。
 * 页面 = 设备卡：基础信息 + 位置补录 + 现场照片 + 关联设备/供电链 + 聚合资料摘要。
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Box, Connection, Document, Location, WarningFilled } from '@element-plus/icons-vue'
import DeviceLocationForm from '@/components/scan/DeviceLocationForm.vue'
import DevicePhotoPanel from '@/components/scan/DevicePhotoPanel.vue'
import DeviceRelationPanel from '@/components/scan/DeviceRelationPanel.vue'
import RelationKindTag from '@/components/scan/RelationKindTag.vue'
import { scanRooms, scanSearchDevice } from '@/api/scan'
import type { ScanRoom, ScanSearchResult } from '@/types/scan'

const route = useRoute()

const code = computed(() => {
  const raw = route.params.code
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
  try {
    return decodeURIComponent(s).trim()
  } catch {
    return s.trim()
  }
})

const loading = ref(true)
const search = ref<ScanSearchResult | null>(null)
const rooms = ref<ScanRoom[]>([])
const rev = ref(0)

watch(
  () => [code.value, rev.value] as const,
  async ([c], _prev, onCleanup) => {
    if (!c) return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    loading.value = true
    try {
      const [s, r] = await Promise.all([scanSearchDevice(c), scanRooms()])
      if (cancelled) return
      search.value = s
      rooms.value = r
      if (!s.found) {
        ElMessage({ type: 'error', message: `未检索到该设备，编号：${c}`, duration: 4000 })
      }
    } catch (e) {
      if (!cancelled) {
        ElMessage({ type: 'error', message: `加载失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
      }
    } finally {
      if (!cancelled) loading.value = false
    }
  },
  { immediate: true },
)

const device = computed(() => search.value?.target ?? null)

const name = computed(() => {
  const s = search.value
  if (device.value?.name) return device.value.name
  const a = (s?.archive?.['asset_name'] as string) || ''
  const f = (s?.fixed_asset?.['asset_name'] as string) || ''
  return a || f || code.value
})

interface Neighbor {
  code: string
  type: string
  kind?: string
}

const neighbors = computed<Neighbor[]>(() => {
  const s = search.value
  const d = device.value
  if (!s?.edges?.length || !d) return []
  const out: Neighbor[] = []
  for (const e of s.edges) {
    if (e.from === d.device_code) out.push({ code: e.to, type: e.type || '关联', kind: e.kind })
    else if (e.to === d.device_code) out.push({ code: e.from, type: e.type || '关联', kind: e.kind })
  }
  return out
})

function nodeName(c: string): string {
  const n = search.value?.nodes?.find((x) => x.device_code === c)
  return n?.name ? `${n.name}（${c}）` : c
}

const archiveLocation = computed(() => (search.value?.archive?.['location'] as string) || '')
</script>

<template>
  <div class="scan-dev">
    <header class="scan-dev__head">
      <div class="scan-dev__head-main min-w-0">
        <h1 class="scan-dev__title">现场扫码 · 设备卡</h1>
        <p class="scan-dev__code mono break-code">{{ code }}</p>
      </div>
      <RouterLink class="scan-dev__link" :to="{ path: '/asset/search' }">高级检索</RouterLink>
    </header>

    <el-skeleton v-if="loading" :rows="6" animated class="panel scan-dev__skeleton" />

    <template v-else-if="search">
      <section class="panel">
        <h3 class="scan-dev__panel-title">
          <el-icon :size="16"><Box /></el-icon>
          <span>设备基础信息</span>
        </h3>
        <div class="scan-dev__base">
          <div class="scan-dev__base-tags">
            <span class="scan-dev__name">{{ name }}</span>
            <span v-if="device?.subsystem_name" class="scan-dev__badge">{{ device.subsystem_name }}</span>
          </div>
          <p v-if="!device" class="scan-dev__warn">
            <el-icon :size="14"><WarningFilled /></el-icon>
            <span>该编号未在设备台账登记（可能仅存在于资料记录）——仍可查看下方聚合资料，但无法补录位置/照片。</span>
          </p>
          <p v-if="device?.building || device?.floor" class="scan-dev__loc">
            <el-icon :size="14"><Location /></el-icon>
            <span>台账位置：{{ device?.building || '' }} {{ device?.floor || '' }} {{ device?.location_desc || '' }}</span>
          </p>
          <p v-if="search.room" class="scan-dev__loc">
            档案机房：{{ search.room.room_code }}（{{ search.room.room_name }} · {{ search.room.building }} {{ search.room.floor }}）
          </p>
          <p v-if="archiveLocation" class="scan-dev__meta">设备档案位置：{{ archiveLocation }}</p>
        </div>
      </section>

      <section v-if="device" class="panel">
        <h3 class="scan-dev__panel-title">位置补录（扫码核实现场）</h3>
        <DeviceLocationForm :key="`${device.id}-${code}`" :device="device" :rooms="rooms" />
      </section>

      <section v-if="device" class="panel">
        <h3 class="scan-dev__panel-title">现场照片</h3>
        <DevicePhotoPanel :device-id="device.id" />
      </section>

      <section class="panel">
        <h3 class="scan-dev__panel-title">
          <el-icon :size="16"><Connection /></el-icon>
          <span>关联与供电链（{{ neighbors.length }}）</span>
        </h3>
        <p v-if="neighbors.length === 0" class="scan-dev__meta">暂无关联设备</p>
        <ul v-else class="scan-dev__neighbors">
          <li v-for="(n, i) in neighbors" :key="i" class="scan-dev__neighbor">
            <RouterLink
              class="scan-dev__neighbor-link ellipsis"
              :to="{ path: `/qr/${encodeURIComponent(n.code)}` }"
              title="扫码页直达该设备"
            >
              {{ nodeName(n.code) }}
            </RouterLink>
            <RelationKindTag :kind="n.kind" :text="n.type" />
          </li>
        </ul>
        <DeviceRelationPanel v-if="device" :device="device" @changed="rev += 1" />
      </section>

      <section class="panel">
        <h3 class="scan-dev__panel-title">
          <el-icon :size="16"><Document /></el-icon>
          <span>聚合资料（{{ search.total_records ?? 0 }} 条记录）</span>
        </h3>
        <p v-if="!search.groups || search.groups.length === 0" class="scan-dev__meta">无动态资料记录</p>
        <div v-for="g in search.groups" :key="g.subsystem_name || 'none'" class="scan-dev__group">
          <span class="scan-dev__group-name">{{ g.subsystem_name || '未归类' }}</span>
          <span class="scan-dev__group-tables">
            {{ g.tables.map((t) => `${t.table_name}(${t.records.length})`).join(' · ') }}
          </span>
        </div>
        <div v-if="search.fixed_asset" class="scan-dev__fixed">
          <p class="scan-dev__fixed-label">固定资产</p>
          <p>资产名称：{{ (search.fixed_asset['asset_name'] as string) || '-' }}　品牌型号：{{ (search.fixed_asset['brand_model'] as string) || '-' }}</p>
          <p>序列号：{{ (search.fixed_asset['serial_no'] as string) || '-' }}　所在位置：{{ (search.fixed_asset['location'] as string) || '-' }}</p>
          <p class="scan-dev__meta">
            使用单位：{{ (search.fixed_asset['use_dept'] as string) || '-' }}　责任人：{{ (search.fixed_asset['responsible'] as string) || '-' }}
          </p>
        </div>
        <p v-if="search.problems && search.problems.length > 0" class="scan-dev__warn">
          <el-icon :size="14"><WarningFilled /></el-icon>
          <span>BA 问题 {{ search.problems.length }} 条未闭环</span>
        </p>
      </section>
    </template>

    <p v-else class="scan-dev__meta">未获取到数据，请确认二维码链接完整。</p>
  </div>
</template>

<style scoped>
.scan-dev { display: flex; flex-direction: column; gap: var(--space-4); max-width: 576px; min-width: 0; }
.scan-dev__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.scan-dev__head-main { min-width: 0; }
.scan-dev__title { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-announce); color: var(--fg); }
.scan-dev__code { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.scan-dev__link { flex: 0 0 auto; font-size: var(--text-xs); color: var(--accent); text-decoration: none; }
.scan-dev__link:hover { text-decoration: underline; }
.scan-dev__skeleton { padding: var(--space-4); }
.scan-dev__panel-title { display: flex; align-items: center; gap: var(--space-1); margin: 0 0 var(--space-3); font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.scan-dev__base { display: flex; flex-direction: column; gap: var(--space-2); }
.scan-dev__base-tags { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.scan-dev__name { font-size: var(--text-lg); color: var(--fg); }
.scan-dev__badge { padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--fg-2); white-space: nowrap; }
.scan-dev__warn { display: flex; align-items: flex-start; gap: var(--space-1); margin: 0; font-size: var(--text-xs); color: var(--warn-fg); }
.scan-dev__loc { display: flex; align-items: center; gap: var(--space-1); margin: 0; font-size: var(--text-sm); color: var(--fg-2); }
.scan-dev__meta { margin: 0; font-size: var(--text-xs); color: var(--muted); }
.scan-dev__neighbors { display: flex; flex-direction: column; gap: var(--space-2); margin: 0 0 var(--space-4); padding: 0; list-style: none; }
.scan-dev__neighbor { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--text-sm); }
.scan-dev__neighbor-link { min-width: 0; color: var(--accent); text-decoration: none; }
.scan-dev__neighbor-link:hover { text-decoration: underline; }
.scan-dev__group { font-size: var(--text-sm); }
.scan-dev__group-name { color: var(--fg); font-weight: var(--weight-emphasize); }
.scan-dev__group-tables { margin-left: var(--space-2); font-size: var(--text-xs); color: var(--muted); }
.scan-dev__fixed { margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--border-soft); font-size: var(--text-sm); color: var(--fg); }
.scan-dev__fixed p { margin: 0 0 var(--space-1); }
.scan-dev__fixed-label { color: var(--muted) !important; }
</style>
