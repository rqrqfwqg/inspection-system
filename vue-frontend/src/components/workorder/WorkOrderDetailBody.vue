<script setup lang="ts">
/**
 * 工单详情主体（.split-3：主区 + 右侧栏）
 * =====================================================================
 * 主区：基本信息 / 现场记录（照片）/ 备件（一期只读镜像）
 * 右侧：相关人 / 流转记录（只读事件日志）
 * 一致性约束：详情页**不复用**台账的 DeviceDetailDrawer；设备信息通过链接跳 `/asset/devices?code=`。
 * 副作用回写：照片等结果必须落在此可见区域，禁止只在 toast 里说一句。
 */
import { computed, ref } from 'vue'
import { Link, Picture, Tools } from '@element-plus/icons-vue'
import WorkOrderTimeline from '@/components/workorder/WorkOrderTimeline.vue'
import { fmtBeijingUtc } from '@/lib/format'
import { woPriorityLabel, woSourceLabel, woTypeLabel } from '@/types/workOrderMeta'
import type { WorkOrderDetail } from '@/types/workOrder'

const props = defineProps<{
  wo: WorkOrderDetail
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'open-device', code: string): void
}>()

const descExpanded = ref(false)

/** 现场照片：来自事件 payload.photo_urls 与 meta.photos（契约无顶层 photos 字段） */
const photos = computed<string[]>(() => {
  const out: string[] = []
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach((x) => { if (typeof x === 'string') out.push(x) })
  }
  const metaPhotos = (props.wo.meta as { photos?: unknown } | undefined)?.photos
  push(metaPhotos)
  for (const ev of props.wo.events ?? []) push((ev.payload as { photo_urls?: unknown })?.photo_urls)
  return Array.from(new Set(out))
})

const desc = computed(() => (props.wo.description ?? '').trim())
const descLong = computed(() => desc.value.length > 180)

interface Row { label: string; value: string; mono?: boolean }
const rows = computed<Row[]>(() => {
  const w = props.wo
  return [
    { label: '类型', value: woTypeLabel(w.type) },
    { label: '优先级', value: woPriorityLabel(w.priority) },
    { label: '是否故障', value: w.failure_flag ? '是（参与 MTBF 统计）' : '否' },
    { label: '设备编号', value: w.asset_device_code || '—', mono: true },
    { label: '房间 / 区域', value: w.room_code || '—', mono: true },
    { label: '子系统', value: w.subsystem_code || '—', mono: true },
    { label: '来源', value: woSourceLabel(w.source) },
    { label: '乐观锁版本', value: `version ${w.version}` },
    { label: '截止时间', value: fmtBeijingUtc(w.due_at) },
    { label: '开始时间', value: fmtBeijingUtc(w.started_at) },
    { label: '完成时间', value: fmtBeijingUtc(w.completed_at) },
    { label: '关闭时间', value: fmtBeijingUtc(w.closed_at) },
    { label: '创建时间', value: fmtBeijingUtc(w.created_at) },
    { label: '更新时间', value: fmtBeijingUtc(w.updated_at) },
  ]
})
</script>

<template>
  <div class="split-3 wb">
    <div class="pane-main wb__main">
      <section class="panel">
        <div class="panel-head"><span class="panel-title">基本信息</span></div>
        <dl class="wb__dl">
          <div v-for="r in rows" :key="r.label" class="wb__dl-row">
            <dt class="wb__dt">{{ r.label }}</dt>
            <dd class="wb__dd" :class="{ mono: r.mono }">
              <button
                v-if="r.label === '设备编号' && wo.asset_device_code"
                type="button"
                class="wb__link mono"
                @click="emit('open-device', wo.asset_device_code)"
              >
                <el-icon :size="16"><Link /></el-icon><span>{{ wo.asset_device_code }}</span>
              </button>
              <span v-else>{{ r.value }}</span>
            </dd>
          </div>
        </dl>

        <div v-if="desc" class="wb__desc">
          <p class="wb__dt">描述</p>
          <p class="wb__desc-text" :class="{ 'is-clamped': descLong && !descExpanded }">{{ desc }}</p>
          <el-button v-if="descLong" link type="primary" @click="descExpanded = !descExpanded">
            {{ descExpanded ? '收起' : '展开' }}
          </el-button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><span class="panel-title">现场记录</span></div>
        <div v-if="!photos.length" class="wb__empty">
          <el-icon :size="24" class="wb__empty-icon"><Picture /></el-icon>
          <p class="wb__empty-text">还没有现场照片。执行人在提交完成时上传，照片会显示在这里。</p>
        </div>
        <div v-else class="wb__photos">
          <el-image
            v-for="(u, i) in photos"
            :key="u"
            class="wb__photo"
            :src="u"
            fit="cover"
            :preview-src-list="photos"
            :initial-index="i"
            preview-teleported
            :alt="`现场照片 ${i + 1}`"
          />
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><span class="panel-title">备件</span></div>
        <div class="wb__empty">
          <el-icon :size="24" class="wb__empty-icon"><Tools /></el-icon>
          <p class="wb__empty-text">
            一期备件为只读镜像：工单页展示建议备件与已记录的耗用；真实库存扣减在二期（Phase B）启用。
            当前该工单暂无已登记的备件耗用。
          </p>
        </div>
      </section>
    </div>

    <div class="pane-end wb__end">
      <section class="panel">
        <div class="panel-head"><span class="panel-title">相关人</span></div>
        <ul class="wb__people">
          <li class="wb__person"><span class="wb__person-role">报修人</span><span class="wb__person-name">用户 #{{ wo.reporter_id }}</span></li>
          <li class="wb__person">
            <span class="wb__person-role">执行人</span>
            <span class="wb__person-name">{{ wo.assignee_id === null ? '未派单' : `用户 #${wo.assignee_id}` }}</span>
          </li>
          <li class="wb__person">
            <span class="wb__person-role">验收人</span>
            <span class="wb__person-name">{{ wo.reviewer_id === null ? '待验收' : `用户 #${wo.reviewer_id}` }}</span>
          </li>
          <li v-if="wo.parent_id !== null" class="wb__person">
            <span class="wb__person-role">来源单</span>
            <span class="wb__person-name mono">#{{ wo.parent_id }}</span>
          </li>
        </ul>
      </section>

      <section class="panel">
        <div class="panel-head"><span class="panel-title">流转记录</span></div>
        <WorkOrderTimeline :events="wo.events ?? []" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.wb { min-width: 0; align-items: flex-start; }
.wb__main, .wb__end { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }

.wb__dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-4); margin: 0; }
.wb__dl-row { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wb__dt { margin: 0; font-size: var(--text-xs); color: var(--muted); }
.wb__dd { margin: 0; font-size: var(--text-sm); color: var(--fg); min-width: 0; word-break: break-word; }
.wb__link {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: 0; border: none; background: none; color: var(--accent);
  font-size: var(--text-sm); cursor: pointer; text-align: left; word-break: break-all;
}
.wb__link:hover { text-decoration: underline; }
.wb__link:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-sm); }

.wb__desc { margin-top: var(--space-3); }
.wb__desc-text { margin: var(--space-1) 0 0; font-size: var(--text-sm); line-height: var(--leading-body); color: var(--fg); white-space: pre-wrap; word-break: break-word; }
.wb__desc-text.is-clamped { display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }

.wb__empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-2); text-align: center; }
.wb__empty-icon { color: var(--meta); }
.wb__empty-text { margin: 0; max-width: 56ch; font-size: var(--text-xs); line-height: var(--leading-body); color: var(--fg-2); }

.wb__photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--space-2); }
.wb__photo { width: 100%; aspect-ratio: 1 / 1; border-radius: var(--radius-md); border: 1px solid var(--border-soft); }

.wb__people { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.wb__person { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); font-size: var(--text-sm); }
.wb__person-role { color: var(--muted); font-size: var(--text-xs); }
.wb__person-name { color: var(--fg); }

@media (max-width: 1279px) {
  .wb__dl { grid-template-columns: minmax(0, 1fr); }
}
</style>
