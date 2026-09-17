<script setup lang="ts">
/**
 * 子系统管理（资料配置 → 子系统）
 * =====================================================================
 * 卡片列出当前子系统（图标名 + 名称 + 编码 + 记录/表归属由外层汇总条承载），支持新增 / 编辑 / 删除。
 * 删除是级联操作（连同其下全部资料表），必须二次确认并写清影响面（UIUX §6.6）。
 *
 * 纪律：`icon` 展示的是 DB 里的 lucide 名文本（不做图标渲染映射，见 SPEC §14 D-03），
 * 因此这里**不把它当图标**渲染，只作为标签文本，避免出现"两套图标风格混排"。
 */
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus } from '@element-plus/icons-vue'
import assetApi from '@/api/assetApi'
import SubsystemFormDialog from './SubsystemFormDialog.vue'
import type { Subsystem } from '@/api/dict'

const props = defineProps<{
  subsystems: Subsystem[]
}>()

const emit = defineEmits<{
  (e: 'changed'): void
}>()

const dialogOpen = ref(false)
const editing = ref<Subsystem | null>(null)

const nextSortOrder = computed(() => props.subsystems.length + 1)

function openAdd() {
  editing.value = null
  dialogOpen.value = true
}

function openEdit(subsystem: Subsystem) {
  editing.value = subsystem
  dialogOpen.value = true
}

async function remove(subsystem: Subsystem) {
  try {
    await ElMessageBox.confirm(
      `将删除子系统「${subsystem.name}」及其下全部资料表与记录，涉及记录数由后端级联处理，操作不可撤销。`,
      '删除子系统',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await assetApi.deleteSubsystem(subsystem.id)
    ElMessage.success(`子系统「${subsystem.name}」已删除`)
    emit('changed')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}
</script>

<template>
  <section class="sm">
    <header class="sm__head">
      <h4 class="sm__title">子系统（<span class="tnum">{{ subsystems.length }}</span>）</h4>
      <el-button size="small" @click="openAdd">
        <el-icon :size="16"><Plus /></el-icon>
        <span>新增子系统</span>
      </el-button>
    </header>

    <div v-if="subsystems.length > 0" class="sm__grid">
      <article v-for="subsystem in subsystems" :key="subsystem.id" class="sm__card">
        <div class="sm__card-head">
          <span class="sm__name ellipsis" :title="subsystem.name">
            {{ subsystem.name || '未命名子系统' }}
          </span>
          <el-tag v-if="subsystem.icon" size="small" type="info" effect="plain" class="mono">
            {{ subsystem.icon }}
          </el-tag>
          <span class="sm__actions">
            <el-button link :aria-label="`编辑子系统 ${subsystem.name}`" title="编辑" @click="openEdit(subsystem)">
              <el-icon :size="16"><Edit /></el-icon>
            </el-button>
            <el-button
              link
              type="danger"
              :aria-label="`删除子系统 ${subsystem.name}`"
              title="删除"
              @click="remove(subsystem)"
            >
              <el-icon :size="16"><Delete /></el-icon>
            </el-button>
          </span>
        </div>
        <p class="sm__code mono ellipsis">code: {{ subsystem.code }}</p>
      </article>
    </div>

    <p v-else class="sm__empty">
      还没有任何子系统：点「新增子系统」建立第一个（例如「电力系统 / power」），再往下建资料表与字段。
    </p>

    <SubsystemFormDialog
      v-model="dialogOpen"
      :editing="editing"
      :next-sort-order="nextSortOrder"
      @saved="emit('changed')"
    />
  </section>
</template>

<style scoped>
.sm {
  min-width: 0;
}

.sm__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.sm__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

/* 卡片栅格自适应列数（不写死列宽），窄档自然降列 */
.sm__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
  min-width: 0;
}

.sm__card {
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.sm__card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.sm__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  font-weight: var(--weight-emphasize);
  color: var(--fg);
}

.sm__actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.sm__code {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}

.sm__empty {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-body);
  color: var(--fg-2);
}
</style>
