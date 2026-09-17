<script setup lang="ts">
/**
 * 现场关联面板：
 *  - 上游供电/冷源链展示（向上回溯或双向，最大 3 跳）
 *  - 现场建边：扫对方设备 / 手输编号（移交/标签号/别名均可）→ 选关系类型 → 提交
 *  - 方向语义：kind=power/cooling 的 forward 边，from=上游(供电方/冷源) → to=下游(受电方/用冷)
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, ArrowUp, Close, Connection, Lightning } from '@element-plus/icons-vue'
import { scanCreateRelation, scanDeleteRelation, scanPowerChain, scanRelationTypes } from '@/api/scan'
import type { PowerChainResult, ScanDevice, ScanRelationType } from '@/types/scan'
import ScanInput from './ScanInput.vue'
import RelationKindTag from './RelationKindTag.vue'

const props = defineProps<{
  device: ScanDevice
}>()

/** 建边/删边成功后通知父级刷新（邻居/链随之更新） */
const emit = defineEmits<{ (e: 'changed'): void }>()

const KIND_LABEL: Record<string, string> = {
  power: '供配电', cooling: '冷源', locate: '位置', network: '网络',
  control: '控制', pipe: '管路', accessory: '配件', other: '其他',
}

const types = ref<ScanRelationType[]>([])
const chain = ref<PowerChainResult | null>(null)
const chainSide = ref<'up' | 'both'>('up')
const loadingChain = ref(false)

// 建边表单
const otherCode = ref('')
const rtype = ref('')
const dir = ref<'up' | 'down'>('up') // 对方相对本设备的方位
const meta = ref('')                 // 备注（回路/线径/端口/VLAN 等）
const submitting = ref(false)

async function loadChain(side: 'up' | 'both') {
  loadingChain.value = true
  try {
    chain.value = await scanPowerChain(props.device.id, side, 3)
  } catch {
    /* 请求失败保留旧链，不打断现场作业 */
  } finally {
    loadingChain.value = false
  }
}

watch(
  () => [props.device.id, chainSide.value] as const,
  ([id, side]) => {
    if (!id) return
    void loadChain(side)
  },
  { immediate: true },
)

watch(
  () => props.device.id,
  async (id) => {
    if (!id) return
    try {
      const t = await scanRelationTypes()
      types.value = t
      // 只在设备切换时初始化默认类型（优先 power 类），避免覆盖用户选择
      if (!rtype.value && t.length) {
        const firstPower = t.find((x) => x.kind === 'power') || t[0]
        rtype.value = firstPower.code
      }
    } catch {
      /* 类型字典失败不阻断面板；建边下拉为空时提交按钮有校验兜底 */
    }
  },
  { immediate: true },
)

const isForward = computed(() => {
  const t = types.value.find((x) => x.code === rtype.value)
  return !!t && (t.kind === 'power' || t.kind === 'cooling') && t.direction === 'forward'
})

const chainEdges = computed(() => chain.value?.edges ?? [])
const hasUpstream = computed(() => chainEdges.value.some((e) => e.side === 'up'))
/** 链上节点按深度升序（起点 depth=0 不展示） */
const chainNodes = computed(() =>
  (chain.value?.nodes ?? [])
    .filter((n) => n.depth > 0)
    .slice()
    .sort((a, b) => a.depth - b.depth),
)

function relOf(nodeCode: string) {
  return (
    chainEdges.value.find((e) => e.side === 'up' && e.to === nodeCode) ||
    chainEdges.value.find((e) => e.side === 'down' && e.from === nodeCode)
  )
}

async function submit() {
  if (!otherCode.value.trim()) {
    ElMessage({ type: 'error', message: '请输入对方设备编号' })
    return
  }
  if (!rtype.value) {
    ElMessage({ type: 'error', message: '请选择关系类型' })
    return
  }
  submitting.value = true
  try {
    const me = props.device.device_code
    // forward 边：from=上游 → to=下游。dir=up => 对方是上游（对方→本设备）
    const from_code = dir.value === 'up' ? otherCode.value.trim() : me
    const to_code = dir.value === 'up' ? me : otherCode.value.trim()
    await scanCreateRelation({
      from_code,
      to_code,
      relation_type: rtype.value,
      meta: meta.value.trim() ? { note: meta.value.trim() } : {},
    })
    ElMessage({ type: 'success', message: '关联已建立' })
    otherCode.value = ''
    meta.value = ''
    void loadChain(chainSide.value)
    emit('changed')
  } catch (e) {
    ElMessage({ type: 'error', message: `建边失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
  } finally {
    submitting.value = false
  }
}

async function delEdge(rid: number) {
  try {
    await scanDeleteRelation(rid)
    ElMessage({ type: 'success', message: '关联已删除' })
    void loadChain(chainSide.value)
    emit('changed')
  } catch (e) {
    ElMessage({ type: 'error', message: `删除失败：${e instanceof Error ? e.message : ''}`, duration: 4000 })
  }
}

function onScanned(code: string) {
  otherCode.value = code
}
</script>

<template>
  <div class="rel-panel">
    <section class="rel-panel__chain">
      <header class="rel-panel__head">
        <h4 class="rel-panel__title">
          <el-icon :size="16" class="rel-panel__zap"><Lightning /></el-icon>
          <span>供电 / 冷源链（{{ chainSide === 'up' ? '向上回溯' : '双向' }}）</span>
        </h4>
        <el-radio-group v-model="chainSide" size="small">
          <el-radio-button value="up">上游</el-radio-button>
          <el-radio-button value="both">双向</el-radio-button>
        </el-radio-group>
      </header>

      <p v-if="loadingChain" class="rel-panel__meta">正在遍历供配电链…</p>
      <p v-else-if="chain && !hasUpstream && chainSide === 'up'" class="rel-panel__meta">
        未发现供电/冷源上游（可现场建边：输入上级配电柜/冷水机组编号并选「取电/供配电/冷源」）
      </p>
      <ul v-if="chain && chainNodes.length" class="rel-panel__list">
        <li v-for="n in chainNodes" :key="n.device_code" class="rel-panel__node">
          <el-icon v-if="relOf(n.device_code)?.side === 'up'" :size="14" class="rel-panel__up"><ArrowUp /></el-icon>
          <el-icon v-else :size="14" class="rel-panel__down"><ArrowDown /></el-icon>
          <span class="rel-panel__code ellipsis">{{ n.name ? `${n.name}（${n.device_code}）` : n.device_code }}</span>
          <RelationKindTag
            v-if="relOf(n.device_code)"
            :kind="types.find((x) => x.label === relOf(n.device_code)?.type)?.kind ?? 'other'"
            :text="relOf(n.device_code)!.type"
          />
          <button
            v-if="relOf(n.device_code)?.rid != null"
            type="button"
            class="rel-panel__del"
            title="删除此关联"
            @click="delEdge(relOf(n.device_code)!.rid!)"
          >
            <el-icon :size="12"><Close /></el-icon>
          </button>
        </li>
      </ul>
    </section>

    <section class="rel-panel__form">
      <h4 class="rel-panel__title">
        <el-icon :size="16" class="rel-panel__link"><Connection /></el-icon>
        <span>现场建边（扫对方设备，或手输编号）</span>
      </h4>
      <ScanInput :on-scan="onScanned" placeholder="扫上级/下级设备二维码或条码" />
      <el-form label-position="top" size="default" @submit.prevent>
        <el-form-item label="对方设备编号（扫码后自动填入，可手工修正；支持别名）">
          <el-input v-model="otherCode" placeholder="上级配电柜 / 冷水机组 / 交换机编号" />
        </el-form-item>
        <div class="rel-panel__grid">
          <el-form-item label="关系类型">
            <el-select v-model="rtype" placeholder="选择类型">
              <el-option
                v-for="t in types"
                :key="t.code"
                :label="`${t.label}（${KIND_LABEL[t.kind] ?? ''}）`"
                :value="t.code"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isForward" label="对方方位">
            <el-select v-model="dir">
              <el-option label="对方是上游（供电方/冷源）" value="up" />
              <el-option label="对方是下游（受电方/用冷）" value="down" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="备注（可选）">
          <el-input v-model="meta" placeholder="回路 / 线径 / 端口 / VLAN 等" />
        </el-form-item>
        <el-button type="primary" :loading="submitting" @click="submit">建立关联</el-button>
      </el-form>
    </section>
  </div>
</template>

<style scoped>
.rel-panel { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.rel-panel__chain, .rel-panel__form { min-width: 0; }
.rel-panel__form { padding-top: var(--space-3); border-top: 1px solid var(--border-soft); }
.rel-panel__head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; }
.rel-panel__title { display: flex; align-items: center; gap: var(--space-1); margin: 0 0 var(--space-2); font-size: var(--text-base); font-weight: var(--weight-emphasize); color: var(--fg); }
.rel-panel__zap { color: var(--warn); }
.rel-panel__link { color: var(--accent); }
.rel-panel__meta { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--muted); }
.rel-panel__list { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-2) 0 0; padding: 0; list-style: none; }
.rel-panel__node { display: flex; align-items: center; gap: var(--space-1); font-size: var(--text-sm); min-width: 0; }
.rel-panel__up { color: var(--warn); }
.rel-panel__down { color: var(--sys-refrig); }
.rel-panel__code { min-width: 0; color: var(--fg-2); }
.rel-panel__del { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; padding: 0 var(--space-1); border: none; background: none; color: var(--meta); cursor: pointer; }
.rel-panel__del:hover { color: var(--danger); }
.rel-panel__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
@media (max-width: 1279px) { .rel-panel__grid { grid-template-columns: minmax(0, 1fr); } }
</style>
