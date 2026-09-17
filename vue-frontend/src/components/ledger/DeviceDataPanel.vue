<script setup lang="ts">
/**
 * 设备数据面板（检索页主体）· 只做编排
 * =====================================================================
 * 由 React `components/asset/DeviceDataPanel.tsx` 等价迁移，**不发请求**，只把画像拆给子组件：
 *  ① `DeviceProfileCard`   设备档案（画像 + 统计量）
 *  ② 子系统档案（本文件内联：命中记录按子系统归堆，空系统也照常显示）
 *  ③ `DeviceChainPanel`    供电 / 冷源链路
 *  ④ `DeviceRelatedList`   关联设备（点击切换继续追溯）
 *
 * 纪律：不写死宽度、`min-width: 0` 防压扁（红线 ②）；颜色全走设计令牌；无 emoji。
 */
import { computed } from 'vue'
import { Grid } from '@element-plus/icons-vue'
import DeviceChainPanel from './DeviceChainPanel.vue'
import DeviceProfileCard from './DeviceProfileCard.vue'
import DeviceRelatedList from './DeviceRelatedList.vue'
import DeviceSubsystemCard from './DeviceSubsystemCard.vue'
import type { SearchResult } from '@/types/asset'
import type { Subsystem } from '@/api/dict'

const props = defineProps<{
  result: SearchResult
  subsystems: Subsystem[]
}>()

const emit = defineEmits<{
  (e: 'pick-device', code: string): void
  (e: 'open-subsystem', code: string): void
}>()

interface SubsystemHit {
  count: number
  tables: string[]
}

/** 子系统 code → { 记录数, 涉及资料表 }；未挂任何子系统的记录归到 `__none__` */
const hitByCode = computed(() => {
  const map = new Map<string, SubsystemHit>()
  for (const group of props.result.groups) {
    const key = group.subsystem_code || '__none__'
    const current = map.get(key) ?? { count: 0, tables: [] }
    for (const table of group.tables) {
      current.count += table.records.length
      if (!current.tables.includes(table.table_name)) current.tables.push(table.table_name)
    }
    map.set(key, current)
  }
  return map
})

const profile = computed(() => props.result.profile)

/** 链路起点：优先供电链起点，缺失回落画像编号 */
const startCode = computed(
  () => props.result.power_chain?.start_code || profile.value?.device_code || '',
)

const label = computed(() => profile.value?.name || profile.value?.device_code || '')

const upstream = computed(() => props.result.power_chain?.upstream ?? [])
const downstream = computed(() => props.result.power_chain?.downstream ?? [])
</script>

<template>
  <section v-if="profile" class="ddp">
    <div class="ddp__top">
      <DeviceProfileCard :profile="profile" class="ddp__profile" />

      <div class="ddp__side">
        <section class="panel ddp__block">
          <header class="ddp__block-head">
            <el-icon :size="16" class="ddp__block-icon"><Grid /></el-icon>
            <h3 class="ddp__block-title">子系统档案</h3>
            <span class="ddp__block-hint">点有资料的系统可跳到明细</span>
          </header>
          <div class="ddp__grid">
            <DeviceSubsystemCard
              v-for="subsystem in subsystems"
              :key="subsystem.id"
              :name="subsystem.name"
              :count="hitByCode.get(subsystem.code)?.count ?? 0"
              :tables="hitByCode.get(subsystem.code)?.tables ?? []"
              @pick="emit('open-subsystem', subsystem.code)"
            />
            <DeviceSubsystemCard
              v-if="hitByCode.has('__none__')"
              name="未归类"
              :count="hitByCode.get('__none__')!.count"
              :tables="hitByCode.get('__none__')!.tables"
              @pick="emit('open-subsystem', '__none__')"
            />
          </div>
        </section>

        <section class="panel ddp__block">
          <DeviceChainPanel :label="label" :upstream="upstream" :downstream="downstream" />
        </section>
      </div>
    </div>

    <section class="panel ddp__block">
      <header class="ddp__block-head">
        <el-icon :size="16" class="ddp__block-icon"><Grid /></el-icon>
        <h3 class="ddp__block-title">关联设备</h3>
        <span class="ddp__block-hint">点击可切换到该设备继续追溯</span>
      </header>
      <DeviceRelatedList
        :nodes="result.nodes"
        :start-code="startCode"
        :edges="result.edges"
        @pick="emit('pick-device', $event)"
      />
    </section>
  </section>
</template>

<style scoped>
.ddp {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

/* 上：档案卡（1 份）+ 右栏（2 份）；窄档自然降为单列，不写死像素 */
.ddp__top {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(0, 2fr);
  gap: var(--space-4);
  align-items: start;
  min-width: 0;
}

@media (max-width: 1279px) {
  .ddp__top {
    grid-template-columns: minmax(0, 1fr);
  }
}

.ddp__profile {
  min-width: 0;
}

.ddp__side {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.ddp__block {
  min-width: 0;
}

.ddp__block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  min-width: 0;
}

.ddp__block-icon {
  color: var(--muted);
}

.ddp__block-title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.ddp__block-hint {
  font-size: var(--text-xs);
  color: var(--muted);
}

.ddp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-3);
  min-width: 0;
}
</style>
