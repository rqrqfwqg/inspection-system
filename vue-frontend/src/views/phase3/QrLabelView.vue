<script setup lang="ts">
/**
 * 二维码标签打印（/asset/qr-labels）—— React 版 QrLabelPage 等价迁移
 * =====================================================================
 * 流程：按 楼栋/楼层/子系统/关键词 筛选设备 → 勾选（上限 300）→ 生成「扫码直达页」
 * 二维码标签 → A4 批量打印。二维码内容与扫码页约定一致：<origin>/ops/qr/<编号>。
 *
 * 行为对齐：
 *  - 分页循环拉满 MAX_LOAD=3000 台（后端单次 limit≤1000），中断条件与 React 版一致
 *  - 全选 = 勾前 MAX_SELECT=300 台；再次点击清空
 *  - 错误走 ElMessage（http.ts 已把 422 detail 拼成可读消息）
 */
import { computed, onMounted, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import PageHead from '@/components/common/PageHead.vue'
import QrLabelSheet from '@/components/qr/QrLabelSheet.vue'
import { scanListDevices, scanSubsystems } from '@/api/scan'
import type { QrDeviceRow, ScanSubsystem } from '@/types/scan'

const MAX_LOAD = 3000
const MAX_SELECT = 300

const subsystems = ref<ScanSubsystem[]>([])
const rows = ref<QrDeviceRow[]>([])
const selected = ref<Set<number>>(new Set())
const loading = ref(false)
const loaded = ref(false)
const printOpen = ref(false)

const filter = ref({ building: '', floor: '', subsystem_id: '', q: '' })

const allChecked = computed(() => rows.value.length > 0 && selected.value.size === rows.value.length)
const labels = computed(() => rows.value.filter((r) => selected.value.has(r.id)))

onMounted(async () => {
  try {
    subsystems.value = await scanSubsystems()
  } catch {
    // 子系统字典拉失败不阻断页面：下拉为空仍可用楼栋/楼层/关键词筛选
    subsystems.value = []
  }
})

async function query(): Promise<void> {
  loading.value = true
  selected.value = new Set()
  try {
    const out: QrDeviceRow[] = []
    let skip = 0
    // 循环分页到上限（后端单次 limit≤1000）
    while (skip < MAX_LOAD) {
      const batch = await scanListDevices({
        building: filter.value.building.trim() || undefined,
        floor: filter.value.floor.trim() || undefined,
        subsystem_id: filter.value.subsystem_id ? Number(filter.value.subsystem_id) : undefined,
        q: filter.value.q.trim() || undefined,
        limit: 1000,
        skip,
      })
      out.push(...batch)
      if (batch.length < 1000) break
      skip += batch.length
    }
    rows.value = out
    loaded.value = true
    ElMessage.success(`加载完成：共 ${out.length} 台设备（上限 ${MAX_LOAD}）`)
  } catch (e) {
    rows.value = []
    loaded.value = true
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function toggle(id: number): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleAll(): void {
  selected.value = allChecked.value
    ? new Set()
    : new Set(rows.value.slice(0, MAX_SELECT).map((r) => r.id))
}

function openPrint(): void {
  if (labels.value.length === 0) {
    ElMessage.warning('请先勾选设备')
    return
  }
  printOpen.value = true
}
</script>

<template>
  <div class="qr-page">
    <PageHead
      title="二维码标签打印"
      desc="筛选并勾选设备，打印「扫码直达」二维码标签贴到现场——扫码即打开该设备卡，用于位置/照片/供配电补录与关联。"
    />

    <div class="panel qr-page__filter no-print">
      <div class="qr-page__filter-grid">
        <el-select
          v-model="filter.subsystem_id"
          placeholder="全部子系统"
          clearable
          class="qr-page__select"
        >
          <el-option
            v-for="s in subsystems"
            :key="s.id"
            :value="String(s.id)"
            :label="s.name"
          />
        </el-select>
        <el-input v-model="filter.building" placeholder="楼栋，如 GTC / 东停车楼" clearable />
        <el-input v-model="filter.floor" placeholder="楼层，如 2F / B1" clearable />
        <el-input
          v-model="filter.q"
          placeholder="编号/名称关键词"
          clearable
          @keyup.enter="query"
        />
        <el-button type="primary" plain :loading="loading" @click="query">
          <el-icon v-if="!loading" :size="16"><Search /></el-icon><span>查询</span>
        </el-button>
      </div>
    </div>

    <div class="panel qr-page__list no-print">
      <div class="qr-page__list-head">
        <p class="qr-page__list-title">
          设备清单
          <span v-if="loaded" class="qr-page__list-meta">命中 {{ rows.length }} · 已选 {{ selected.size }}</span>
        </p>
        <div class="qr-page__list-actions">
          <el-button size="small" :type="allChecked ? 'primary' : 'default'" plain @click="toggleAll">
            {{ allChecked ? '取消全选' : '全选' }}
          </el-button>
          <el-button size="small" type="primary" @click="openPrint">
            打印标签（{{ labels.length }}）
          </el-button>
        </div>
      </div>

      <div class="qr-page__rows">
        <p v-if="!loaded && !loading" class="qr-page__hint">
          输入条件后点「查询」。一次最多加载 {{ MAX_LOAD }} 台、勾选 {{ MAX_SELECT }} 张。
        </p>
        <p v-else-if="loading" class="qr-page__hint">加载中，请稍候…</p>
        <el-empty v-else-if="rows.length === 0" description="无匹配设备，请调整楼栋 / 楼层 / 子系统或关键词后重新查询" :image-size="72" />
        <template v-else>
          <label v-for="r in rows" :key="r.id" class="qr-page__row">
            <el-checkbox
              class="qr-page__check"
              :model-value="selected.has(r.id)"
              @change="toggle(r.id)"
            />
            <span class="qr-page__code mono ellipsis">{{ r.device_code }}</span>
            <span class="qr-page__name ellipsis min-w-0">{{ r.name }}</span>
            <el-tag v-if="r.subsystem_name" size="small" type="info" class="qr-page__tag">
              {{ r.subsystem_name }}
            </el-tag>
            <span class="qr-page__pos ellipsis">
              {{ [r.building, r.floor].filter(Boolean).join(' ') }}
            </span>
          </label>
        </template>
      </div>
    </div>

    <QrLabelSheet v-if="printOpen" :labels="labels" @close="printOpen = false" />
  </div>
</template>

<style scoped>
.qr-page { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }

.qr-page__filter-grid {
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) repeat(3, minmax(0, 1fr)) auto;
  gap: var(--space-3);
}
.qr-page__select { width: 100%; min-width: 0; }

.qr-page__list { display: flex; flex-direction: column; min-width: 0; }
.qr-page__list-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3); margin-bottom: var(--space-3); flex-wrap: wrap;
}
.qr-page__list-title { margin: 0; font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.qr-page__list-meta { margin-left: var(--space-2); font-size: var(--text-sm); font-weight: var(--weight-read); color: var(--muted); }
.qr-page__list-actions { display: flex; align-items: center; gap: var(--space-2); }

.qr-page__rows { max-height: 46vh; overflow: auto; min-width: 0; }
.qr-page__hint { margin: var(--space-2) 0; font-size: var(--text-sm); color: var(--muted); }
.qr-page__row {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-2) var(--space-1);
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
  min-width: 0;
}
.qr-page__row:hover { background: var(--surface-2); }
.qr-page__check { flex: 0 0 auto; }
.qr-page__code { flex: 0 0 176px; font-size: var(--text-sm); color: var(--fg); }
.qr-page__name { flex: 1 1 auto; font-size: var(--text-sm); color: var(--fg-2); }
.qr-page__tag { flex: 0 0 auto; }
.qr-page__pos { flex: 0 0 112px; text-align: right; font-size: var(--text-xs); color: var(--muted); }

@media (max-width: 1535px) {
  .qr-page__filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
