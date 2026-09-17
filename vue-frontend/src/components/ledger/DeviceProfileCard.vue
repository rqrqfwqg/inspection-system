<script setup lang="ts">
/**
 * 设备档案卡（设备数据面板左上）
 * =====================================================================
 * 纯展示：画像名称 / 编号 / 归属标签 / 位置机房 / 照片数 / 资料表 + 3 个统计量。
 * 从 `DeviceDataPanel` 抽出，让面板主文件只留编排（ARCHITECTURE §7 规则 2：单文件 ≤300 行）。
 *
 * 纪律：颜色全部走设计令牌；长编号走 `.break-code`（不得省略）；无 emoji。
 */
import { Box, Location, Picture, PriceTag, Tickets } from '@element-plus/icons-vue'
import type { DeviceProfile } from '@/types/asset'

const props = defineProps<{
  profile: DeviceProfile
}>()

function locationLine(): string {
  return [props.profile.building, props.profile.floor].filter((x) => !!x).join(' · ')
}
</script>

<template>
  <article class="panel dprofile">
    <header class="dprofile__identity">
      <span class="dprofile__avatar"><el-icon :size="20"><Tickets /></el-icon></span>
      <div class="dprofile__main">
        <div class="dprofile__name ellipsis" :title="profile.name || profile.device_code">
          {{ profile.name || profile.device_code }}
        </div>
        <div class="dprofile__code mono break-code">{{ profile.device_code }}</div>
      </div>
    </header>

    <div class="dprofile__tags">
      <el-tag v-if="profile.subsystem_name" size="small" type="info" effect="light">
        {{ profile.subsystem_name }}
      </el-tag>
      <el-tag v-if="profile.in_ledger" size="small" effect="plain">
        <el-icon :size="14"><Tickets /></el-icon>
        <span>已登记台账</span>
      </el-tag>
      <el-tag v-else size="small" type="warning" effect="plain">
        <el-icon :size="14"><Box /></el-icon>
        <span>现场台账</span>
      </el-tag>
      <el-tag v-if="!profile.tag_no" size="small" type="warning" effect="plain">
        <el-icon :size="14"><PriceTag /></el-icon>
        <span>标签号待补录</span>
      </el-tag>
    </div>

    <dl class="dprofile__meta">
      <div v-if="locationLine()" class="dprofile__row">
        <dt><el-icon :size="14"><Location /></el-icon><span>位置</span></dt>
        <dd>{{ locationLine() }}</dd>
      </div>
      <div v-if="profile.location" class="dprofile__row">
        <dt><span>所在地点</span></dt>
        <dd>{{ profile.location }}</dd>
      </div>
      <div v-if="profile.room?.room_name" class="dprofile__row">
        <dt><span>所在机房</span></dt>
        <dd>
          {{ profile.room.room_name }}
          <span v-if="profile.room.room_code" class="mono">（{{ profile.room.room_code }}）</span>
        </dd>
      </div>
      <div v-if="profile.tag_no" class="dprofile__row">
        <dt><span>标签号</span></dt>
        <dd class="mono">{{ profile.tag_no }}</dd>
      </div>
      <div class="dprofile__row">
        <dt><el-icon :size="14"><Picture /></el-icon><span>现场照片</span></dt>
        <dd>{{ profile.photo_count }} 张</dd>
      </div>
      <div v-if="profile.source_tables.length > 0" class="dprofile__row">
        <dt><span>资料表</span></dt>
        <dd class="dprofile__tables">{{ profile.source_tables.join(' / ') }}</dd>
      </div>
    </dl>

    <div class="dprofile__stats">
      <div class="dprofile__stat">
        <span class="dprofile__stat-num tnum">{{ profile.related_count }}</span>
        <span class="dprofile__stat-label">关联设备</span>
      </div>
      <div class="dprofile__stat">
        <span class="dprofile__stat-num tnum">{{ profile.record_count }}</span>
        <span class="dprofile__stat-label">资料条数</span>
      </div>
      <div class="dprofile__stat">
        <span class="dprofile__stat-num tnum">{{ profile.subsystem_count }}</span>
        <span class="dprofile__stat-label">涉及系统</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.dprofile {
  min-width: 0;
}

.dprofile__identity {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
}

.dprofile__avatar {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
}

.dprofile__main {
  min-width: 0;
}

.dprofile__name {
  min-width: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.dprofile__code {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--muted);
}

.dprofile__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-3);
}

.dprofile__tags :deep(.el-tag) {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.dprofile__meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: var(--space-4) 0 0;
  font-size: var(--text-xs);
  color: var(--fg-2);
}

.dprofile__row {
  display: flex;
  gap: var(--space-2);
  min-width: 0;
}

.dprofile__row dt {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: 72px;
  color: var(--muted);
}

.dprofile__row dd {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  word-break: break-word;
}

.dprofile__tables {
  color: var(--muted);
}

.dprofile__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-4);
  text-align: center;
}

.dprofile__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) 0;
  border-radius: var(--radius-md);
  background: var(--surface-2);
  min-width: 0;
}

.dprofile__stat-num {
  font-size: var(--text-lg);
  font-weight: var(--weight-announce);
  color: var(--fg);
}

.dprofile__stat-label {
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
