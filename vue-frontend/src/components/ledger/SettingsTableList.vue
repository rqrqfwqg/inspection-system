<script setup lang="ts">
/**
 * 资料配置 · 左列「资料表清单」
 * =====================================================================
 * 新建（表编码 + 表名称）/ 选中 / 删除，并显示每张表的真实覆盖率。
 * 从 `SettingsFieldsTab` 抽出以控制单文件行数（ARCHITECTURE §7 规则 2）。
 *
 * 纪律：本组件**只发事件**，不直接调 API（数据操作留在 Tab 层统一编排，便于失败提示与刷新）；
 * 覆盖率条复用 `components/viz/CoverageBar.vue`。
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import CoverageBar from '@/components/viz/CoverageBar.vue'
import { fmtPercent } from '@/lib/format'
import type { DataTable } from '@/types/asset'
import type { LinkTableStat } from '@/types/assetViz'

const props = defineProps<{
  tables: DataTable[]
  loading: boolean
  selectedId: string
  statMap: Map<number, LinkTableStat>
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'create', payload: { code: string; name: string }): void
  (e: 'remove', table: DataTable): void
}>()

const newCode = ref('')
const newName = ref('')

function submit() {
  const code = newCode.value.trim()
  const name = newName.value.trim()
  if (!code || !name) {
    ElMessage.warning('请填写表编码与表名称')
    return
  }
  emit('create', { code, name })
  newCode.value = ''
  newName.value = ''
}
</script>

<template>
  <div class="stl">
    <h4 class="stl__title">资料表（<span class="tnum">{{ props.tables.length }}</span>）</h4>

    <div class="stl__new">
      <el-input v-model="newCode" class="stl__new-ctl" placeholder="表编码，如 lighting_fixtures" />
      <el-input v-model="newName" class="stl__new-ctl" placeholder="表名称，如 灯具台账" />
      <el-button type="primary" @click="submit">
        <el-icon :size="16"><Plus /></el-icon>
        <span>新增</span>
      </el-button>
    </div>

    <p v-if="props.loading" class="stl__hint">正在加载资料表…</p>

    <ul v-else-if="props.tables.length > 0" class="stl__list">
      <li
        v-for="item in props.tables"
        :key="item.id"
        class="stl__item"
        :class="{ 'stl__item--active': String(item.id) === props.selectedId }"
      >
        <div class="stl__head">
          <button type="button" class="stl__main" @click="emit('select', String(item.id))">
            <span class="stl__name ellipsis" :title="item.name">{{ item.name }}</span>
            <span class="stl__code mono ellipsis">{{ item.code }}</span>
          </button>
          <el-tag size="small" effect="plain" class="tnum">{{ item.field_count ?? 0 }} 字段</el-tag>
          <el-button
            link
            type="danger"
            :aria-label="`删除资料表 ${item.name}`"
            title="删除资料表"
            @click="emit('remove', item)"
          >
            <el-icon :size="16"><Delete /></el-icon>
          </el-button>
        </div>

        <div v-if="props.statMap.get(item.id)" class="stl__cov">
          <CoverageBar :value="props.statMap.get(item.id)!.coverage" class="stl__bar" />
          <span class="stl__meta tnum">
            {{ props.statMap.get(item.id)!.records }} 条 ·
            {{ fmtPercent(props.statMap.get(item.id)!.coverage, 0) }}
          </span>
          <span v-if="props.statMap.get(item.id)!.unresolved > 0" class="stl__miss tnum">
            {{ props.statMap.get(item.id)!.unresolved }} 未解析
          </span>
        </div>
        <p v-else class="stl__none">暂无记录</p>
      </li>
    </ul>

    <p v-else class="stl__hint">该子系统下暂无资料表：用上方表单新增第一张表。</p>
  </div>
</template>

<style scoped>
.stl {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.stl__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.stl__new {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}

.stl__new-ctl {
  flex: 1 1 140px;
  min-width: 0;
}

.stl__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
}

.stl__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.stl__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  min-width: 0;
}

.stl__item--active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.stl__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.stl__main {
  flex: 1 1 auto;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
}

.stl__name {
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.stl__code {
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.stl__cov {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.stl__bar {
  flex: 1 1 auto;
  min-width: 0;
}

.stl__meta {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
}

.stl__miss {
  flex: 0 0 auto;
  color: var(--danger-fg);
  font-weight: var(--weight-emphasize);
}

.stl__none {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--meta);
}
</style>
