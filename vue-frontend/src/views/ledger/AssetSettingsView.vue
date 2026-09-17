<script setup lang="ts">
/**
 * 资料配置（/asset/settings）
 * =====================================================================
 * 由 React `pages/asset/AssetSettingsPage.tsx`（704 行）等价迁移。**本文件只做编排**：
 * 数据源在 `useAssetSettings`，三张 Tab 各自成组件（子系统 / 资料表与字段 / 关联管理），
 * 页面本身不持有业务状态，只负责 KPI 条、Tab 切换与「刷新联动」。
 *
 * 纪律：不 import `@/router`、不改 `src/styles/**`；颜色走设计令牌；无 emoji。
 * 「联动中心」用 `router-link`（保留 SPA 导航，不手写 location 跳转）。
 */
import { onMounted, ref } from 'vue'
import { Connection, Refresh } from '@element-plus/icons-vue'
import SettingsFieldsTab from '@/components/ledger/SettingsFieldsTab.vue'
import SettingsKpiStrip from '@/components/ledger/SettingsKpiStrip.vue'
import SettingsRelationTab from '@/components/ledger/SettingsRelationTab.vue'
import SettingsSubsystemTab from '@/components/ledger/SettingsSubsystemTab.vue'
import { useAssetSettings } from '@/composables/useAssetSettings'

const settings = useAssetSettings()
const activeTab = ref('subsystems')

onMounted(() => {
  void settings.reloadAll()
})

/** 关联增删后：刷新边列表 + 全局画像（KPI 与来源构成同步更新） */
function onRelationsChanged() {
  void settings.reloadRelations()
  void settings.loadOverview()
}

/** 资料表 / 字段变更后：刷新全局画像（表数、字段数、记录数、覆盖率） */
function onCatalogChanged() {
  void settings.loadOverview()
}
</script>

<template>
  <div class="asv">
    <header class="asv__head">
      <div class="asv__titles">
        <h1 class="asv__title">资料配置</h1>
        <p class="asv__sub">
          维护子系统、资料表字段与设备关联关系。页面数据与「数据表管理」实时联动，口径同源。
        </p>
      </div>

      <div class="asv__actions">
        <el-button :loading="settings.loadingOverview.value" @click="settings.reloadAll()">
          <el-icon v-if="!settings.loadingOverview.value" :size="16"><Refresh /></el-icon>
          <span>刷新联动</span>
        </el-button>
        <router-link class="asv__link" :to="{ path: '/asset-viz', query: { tab: 'link' } }">
          <el-icon :size="16"><Connection /></el-icon>
          <span>联动中心</span>
        </router-link>
      </div>
    </header>

    <SettingsKpiStrip
      :overview="settings.overview.value"
      :relation-count="settings.relations.value.length"
    />

    <p v-if="settings.overviewError.value" class="asv__warn" role="alert">
      <span>联动画像加载失败：{{ settings.overviewError.value }}</span>
      <el-button link @click="settings.loadOverview()">重试</el-button>
    </p>

    <el-tabs v-model="activeTab" class="asv__tabs">
      <el-tab-pane label="子系统" name="subsystems">
        <SettingsSubsystemTab
          :overview="settings.overview.value"
          :subsystems="settings.subsystems.value"
          @changed="settings.loadSubsystems()"
        />
      </el-tab-pane>

      <el-tab-pane label="资料表与字段" name="fields">
        <SettingsFieldsTab
          :subsystems="settings.subsystems.value"
          :overview="settings.overview.value"
          @changed="onCatalogChanged"
        />
      </el-tab-pane>

      <el-tab-pane label="关联管理" name="relations">
        <SettingsRelationTab
          :overview="settings.overview.value"
          :relations="settings.relations.value"
          :devices="settings.devices.value"
          @changed="onRelationsChanged"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.asv {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.asv__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 0;
}

.asv__titles {
  min-width: 0;
}

.asv__title {
  margin: 0;
  font-size: var(--text-2xl);
  line-height: var(--leading-tight);
  font-weight: var(--weight-announce);
  letter-spacing: var(--tracking-display);
  color: var(--fg);
}

.asv__sub {
  margin: var(--space-1) 0 0;
  max-width: 80ch;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}

.asv__actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.asv__link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-3);
  height: var(--el-component-size, 32px);
  border: 1px solid var(--border);
  border-radius: var(--el-border-radius-base, var(--radius-md));
  background: var(--surface);
  color: var(--fg-2);
  font-size: var(--text-base);
  text-decoration: none;
  transition: color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard);
}

.asv__link:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.asv__warn {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--warn);
  border-radius: var(--radius-md);
  background: var(--warn-bg);
  color: var(--warn-fg);
  font-size: var(--text-sm);
}

.asv__tabs {
  min-width: 0;
}

@media (max-width: 1279px) {
  .asv__title {
    font-size: var(--text-xl);
  }
}
</style>
