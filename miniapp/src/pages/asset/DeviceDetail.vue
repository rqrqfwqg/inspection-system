<template>
  <view class="page">
    <block v-if="!detail">
      <view class="hint">{{ loading ? '加载中…' : '未找到该设备' }}</view>
      <!-- 🔴 现场最高频场景：扫到码但台账没有 → 当场建档 -->
      <view class="create-cta" v-if="!loading && code" @tap="goCreate">
        <text class="c-t">台账里没有这台设备？</text>
        <text class="c-d">现场新建设备档案 ›</text>
      </view>
    </block>

    <block v-else>
      <!-- 临时编号红条（识别口径：编号以 TMP- 开头）：不显眼地放着，用户会以为这就是固定资产编号 -->
      <view class="tmp-bar" v-if="isTempCode">
        <view class="tmp-bar-t">本设备为临时编号，补录后自动归档</view>
        <view class="tmp-bar-d">补录时资料记录、照片、关联关系、工单会一并改挂到新编号</view>
        <view class="tmp-bar-btn" @tap="openRebind">补录编号</view>
      </view>

      <!-- 头部二维码 -->
      <view class="card qr-card">
        <view class="qr-title">设备二维码</view>
        <QrCode :text="qrContent" :size="200" />
        <view class="qr-code">{{ code }}</view>
        <view class="qr-note">微信/巡检 App 扫一扫直达该设备</view>
      </view>

      <!-- 基本信息 -->
      <view class="section-title">设备信息</view>
      <view class="card" v-if="detail.device">
        <view class="row"><text class="k">固定资产编号</text><text class="v">{{ detail.device.device_code }}</text></view>
        <view class="row"><text class="k">名称</text><text class="v">{{ detail.device.name || '—' }}</text></view>
        <view class="row" v-if="detail.device.subsystem_name"><text class="k">子系统</text><text class="v">{{ detail.device.subsystem_name }}</text></view>
        <view class="row" v-if="detail.device.building"><text class="k">楼栋/楼层</text><text class="v">{{ detail.device.building }} {{ detail.device.floor || '' }}</text></view>
        <view class="row" v-if="detail.device.location_desc"><text class="k">位置</text><text class="v">{{ detail.device.location_desc }}</text></view>
        <view class="row" v-if="detail.area"><text class="k">区域</text><text class="v">{{ detail.area }}</text></view>
      </view>

      <!-- 设备定位地图（扫码时记的坐标） -->
      <view class="section-title">设备定位</view>
      <view class="card">
        <MiniMap
          :markers="geoMarkers"
          :circles="geoCircles"
          :height="380"
          focus-label="看设备位置"
          empty-title="该设备暂无定位记录"
          empty-desc="用「扫码定位绑定」扫一次这台设备，就会记录它当时的位置；也可以直接用下方「手动修正位置」在地图上标点"
        />
        <view class="geo-ops">
          <button class="geo-btn" @tap="onManualFix">
            {{ geo.manual ? '重新手动修正位置' : '手动修正位置' }}
          </button>
        </view>
        <view class="geo-manual-tip" v-if="geo.manual">
          <text class="gmt-flag">人工</text>
          <text class="gmt-txt">
            当前展示的是人工修正后的位置（{{ fmtTime(geo.manualAt) }}<template v-if="manualAgo">，{{ manualAgo }}</template>），橙色气泡为人工标注
          </text>
        </view>
        <!-- 🔴 人工点永久优先（不设有效期），所以「标了多久」必须让用户看见：
             23 天前标错的一公里级坐标，不能显示得像当前位置一样可信。 -->
        <view class="geo-warn" v-if="geo.manual">
          <text class="gw-t">⚠ 人工标注{{ manualAgo ? '（' + manualAgo + '）' : '' }}</text>
          <text class="gw-d" v-if="manualAccuracyBad">
            该人工标注的精度记录为 {{ geo.manualAccuracy }} 米，误差范围已超 400 米，
            请核对是否标错；确认有误请重新手动修正位置。
          </text>
          <text class="gw-d" v-else-if="geo.manualAccuracy == null">
            人工选点，无精度记录 —— 该点只能说明「标注人认为设备在此处」，无法量化误差。
          </text>
          <text class="gw-d" v-else>
            精度记录约 {{ geo.manualAccuracy }} 米，橙色圈为标注误差范围。
          </text>
        </view>
        <view class="geo-meta" v-if="geo.point">
          <view class="gm-row">
            <text class="gm-k">最近观测</text>
            <text class="gm-v">{{ fmtTime(geo.lastAt) || '—' }}</text>
          </view>
          <view class="gm-row">
            <text class="gm-k">定位来源</text>
            <text class="gm-v">{{
              geo.manual
                ? geo.manualAccuracy == null
                  ? '人工选点（无精度记录）'
                  : '人工选点（精度 ' + Math.round(geo.manualAccuracy) + ' 米）'
                : '扫码自动定位'
            }}</text>
          </view>
          <view class="gm-row" v-if="!geo.manual">
            <text class="gm-k">定位精度</text>
            <text class="gm-v" :class="{ warn: (geo.point.accuracy || 0) > 100 }">
              {{ geo.point.accuracy ? '约 ' + Math.round(geo.point.accuracy) + ' 米' : '未知' }}
            </text>
          </view>
          <view class="gm-row" v-if="geo.manual">
            <text class="gm-k">标注距今</text>
            <text class="gm-v" :class="{ warn: !!manualAgo }">{{ manualAgo || '刚刚' }}</text>
          </view>
          <view class="gm-row">
            <text class="gm-k">观测次数</text>
            <text class="gm-v">{{ geo.samples }} 次</text>
          </view>
          <view class="gm-note">
            <template v-if="geo.manual">
              人工选点已作为一条新观测追加保存（保留此前所有扫码记录作为移动证据）。
              人工点永久优先于自动定位，不会自动过期——请按上面的「标注距今」判断它是否还成立。
            </template>
            <template v-else>
              蓝圈为定位误差范围。室内定位误差通常几十至上百米，该点只能说明
              「这台设备在机场这一片被扫过」，精确位置以扫码绑定的房间为准。
            </template>
          </view>
        </view>
      </view>

      <!-- 固定资产台账 -->
      <view class="section-title">固定资产台账</view>
      <view class="card" v-if="detail.fixed_asset">
        <view class="row"><text class="k">资产名称</text><text class="v">{{ detail.fixed_asset.asset_name || '—' }}</text></view>
        <view class="row"><text class="k">品牌型号</text><text class="v">{{ detail.fixed_asset.brand_model || '—' }}</text></view>
        <view class="row"><text class="k">机身编号</text><text class="v">{{ serialNo || '—' }}</text></view>
        <view class="row" v-if="detail.fixed_asset.serial_no"><text class="k">序列号</text><text class="v">{{ detail.fixed_asset.serial_no }}</text></view>
        <view class="row" v-if="detail.fixed_asset.owner_unit"><text class="k">权属单位</text><text class="v">{{ detail.fixed_asset.owner_unit }}</text></view>
        <view class="row" v-if="detail.fixed_asset.use_dept"><text class="k">使用部门</text><text class="v">{{ detail.fixed_asset.use_dept }}</text></view>
        <view class="row" v-if="detail.fixed_asset.location"><text class="k">位置</text><text class="v">{{ detail.fixed_asset.location }}</text></view>
        <view class="row" v-if="detail.fixed_asset.recv_date"><text class="k">接收日期</text><text class="v">{{ detail.fixed_asset.recv_date }}</text></view>
        <view class="row" v-if="detail.fixed_asset.warranty_end"><text class="k">保修到期</text><text class="v">{{ detail.fixed_asset.warranty_end }}</text></view>
        <view class="row" v-if="detail.fixed_asset.transfer_no"><text class="k">转资单号</text><text class="v">{{ detail.fixed_asset.transfer_no }}</text></view>
        <view class="row" v-if="detail.fixed_asset.tag_no"><text class="k">标签号</text><text class="v">{{ detail.fixed_asset.tag_no }}</text></view>
      </view>
      <view class="card empty" v-else>无固定资产台账记录</view>

      <!-- 设备档案 -->
      <view class="section-title" v-if="detail.archive">设备档案</view>
      <view class="card" v-if="detail.archive">
        <view class="row" v-if="detail.archive.manufacturer"><text class="k">制造商</text><text class="v">{{ detail.archive.manufacturer }}</text></view>
        <view class="row" v-if="detail.archive.system_text"><text class="k">系统</text><text class="v">{{ detail.archive.system_text }}</text></view>
        <view class="row" v-if="detail.archive.location"><text class="k">位置</text><text class="v">{{ detail.archive.location }}</text></view>
      </view>

      <!-- 统计 -->
      <view class="section-title">关联数据</view>
      <view class="card stats">
        <view class="stat"><view class="num">{{ detail.record_count || 0 }}</view><view class="lbl">资料记录</view></view>
        <view class="stat"><view class="num">{{ (detail.relations || []).length }}</view><view class="lbl">关联关系</view></view>
      </view>

      <!-- 设备关联：相互关联 + 上下游 -->
      <view class="section-title">设备关联</view>
      <view class="card">
        <view class="rel-tabs">
          <view :class="['rel-tab', { active: relTab === 'mutual' }]" @tap="relTab = 'mutual'">相互关联</view>
          <view :class="['rel-tab', { active: relTab === 'chain' }]" @tap="relTab = 'chain'">上下游</view>
        </view>

        <block v-if="relTab === 'mutual'">
          <view class="rel-head">
            <text class="rel-count">{{ mutualRels.length }} 条</text>
            <text class="rel-add" @tap="openAdd('mutual')">+ 添加</text>
          </view>
          <view v-if="!mutualRels.length" class="rel-empty">暂无相互关联</view>
          <view class="rel-item" v-for="e in mutualRels" :key="e.id">
            <view class="rel-main">
              <text class="rel-code">{{ relOtherCode(e) }}</text>
              <text class="rel-type">{{ e.relation_type }}</text>
            </view>
            <view class="rel-sub" v-if="relOtherName(e) || relSourceTag(e)">
              <text v-if="relOtherName(e)" class="rel-name">{{ relOtherName(e) }}</text>
              <text v-if="relSourceTag(e)" :class="['rel-src', e.source]">{{ relSourceTag(e) }}</text>
            </view>
            <text class="rel-del" @tap="removeRel(e.id)">删除</text>
          </view>
        </block>

        <block v-if="relTab === 'chain'">
          <view class="rel-head">
            <text class="rel-count">{{ chainRels.length }} 条</text>
            <text class="rel-add" @tap="openAdd('chain')">+ 添加</text>
          </view>
          <view v-if="!chainRels.length" class="rel-empty">暂无上下游关联</view>
          <view class="rel-item" v-for="e in chainRels" :key="e.id">
            <view class="rel-main">
              <text :class="['rel-dir', e.direction]">{{ relDirectionTag(e) }}</text>
              <text class="rel-code">{{ relOtherCode(e) }}</text>
              <text class="rel-type">{{ e.relation_type }}</text>
            </view>
            <view class="rel-sub" v-if="relOtherName(e) || relSourceTag(e)">
              <text v-if="relOtherName(e)" class="rel-name">{{ relOtherName(e) }}</text>
              <text v-if="relSourceTag(e)" :class="['rel-src', e.source]">{{ relSourceTag(e) }}</text>
            </view>
            <text class="rel-del" @tap="removeRel(e.id)">删除</text>
          </view>
        </block>
      </view>

      <!-- 添加关联弹层 -->
      <view v-if="showAdd" class="sheet-mask" @tap="showAdd = false">
        <view class="sheet" @tap.stop>
          <view class="sheet-title">{{ targetKind === 'room' ? '登记房间供电归属' : (addTab === 'mutual' ? '添加相互关联' : '添加上下游关联') }}</view>
          <view class="sheet-row">
            <text class="sr-k">目标类型</text>
            <view class="sr-seg">
              <text :class="['seg-i', { on: targetKind === 'device' }]" @tap="setTargetKind('device')">设备</text>
              <text :class="['seg-i', { on: targetKind === 'room' }]" @tap="setTargetKind('room')">房间</text>
            </view>
          </view>
          <view class="sheet-row">
            <text class="sr-k">关系类型</text>
            <picker class="sr-picker" :value="typePickerIndex" :range="addTypeList"
              range-key="label" @change="onTypePick">
              <view class="sr-pv">{{ addType || '请选择' }}</view>
            </picker>
          </view>
          <view class="sheet-row" v-if="targetKind === 'device'">
            <text class="sr-k">对方编号</text>
            <input class="sr-inp" v-model="addOther" placeholder="输入或扫码编号" />
            <text class="sr-scan" @tap="scanOther">扫码</text>
          </view>
          <block v-else>
            <view class="sheet-row">
              <text class="sr-k">目标房间</text>
              <input class="sr-inp" :value="roomKw" placeholder="搜编号 / 房间名 / 楼栋 / 楼层" @input="onRoomInput" />
            </view>
            <view class="room-tip" v-if="roomSearching">搜索中…</view>
            <view class="room-hits" v-if="roomHits.length">
              <view class="rh-item" v-for="r in roomHits" :key="r.code" @tap="pickRoom(r)">
                <text class="rh-addr">{{ r.address }}</text>
                <text class="rh-code">{{ r.code }}</text>
              </view>
            </view>
            <view class="room-picked" v-else-if="addOther">
              <text>已选房间：{{ addOther }}</text>
            </view>
            <view class="room-tip">登记该房间由哪台配电柜供电；房间不会被建成设备，不影响设备台账。</view>
          </block>
          <view class="sheet-ok" :class="{ disabled: addSaving }" @tap="submitAdd">
            {{ addSaving ? '保存中…' : '确认添加' }}
          </view>
        </view>
      </view>

      <!-- 补录编号弹层 -->
      <view v-if="showRebind" class="sheet-mask" @tap="showRebind = false">
        <view class="sheet" @tap.stop>
          <view class="sheet-title">补录正式编号</view>
          <view class="sheet-row">
            <text class="sr-k">新编号</text>
            <input class="sr-inp" v-model="rebindCode" placeholder="输入固定资产编号" />
          </view>
          <view class="rebind-tip">临时编号 {{ code }} 将被替换；资料记录 / 照片 / 关联关系 / 工单会一并改挂到新编号。</view>
          <view class="sheet-ok" :class="{ disabled: rebindSaving }" @tap="submitRebind">
            {{ rebindSaving ? '补录中…' : '确认补录' }}
          </view>
        </view>
      </view>

      <view class="actions">
        <button class="act act-primary" @tap="goScanBind">扫码定位绑定</button>
        <button class="act act-outline" @tap="goPrint">加入打印清单</button>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  assetLedgerDetail, assetDeviceLink, assetRelationTypes,
  assetRelations, assetCreateRelation, assetDeleteRelation, parseScanPayload,
  assetRoomSearch, assetRebindDeviceCode,
} from '@/api/asset'
import type { AssetRoomHit } from '@/api/asset'
import type {
  AssetLedgerDetail, AssetRelationType, DeviceRelationItem, AssetDeviceLinkEdge,
} from '@/types/asset'
import { deviceGeo, fmtAgo, isUsable, reportManualDeviceGeo } from '@/api/geo'
import type { DeviceGeoResult } from '@/api/geo'
import { chooseLocation, chooseFailText, choosePending } from '@/composables/useChooseLocation'
import MiniMap from '@/components/MiniMap.vue'
import type { MiniMapCircle, MiniMapMarker } from '@/components/MiniMap.vue'
import { extractSerialNo } from '@/utils/deviceLabel'
import { stripCircuitLabelRelations } from '@/utils/linkEdges'
import QrCode from '@/components/QrCode.vue'
import { set as setStore } from '@/utils/storage'
import { showToast } from '@/utils/feedback'
import { useAuthStore } from '@/store/auth'

const auth = useAuthStore()
const operator = computed(() => auth.user?.real_name || auth.user?.phone || '')

const code = ref('')
const detail = ref<AssetLedgerDetail | null>(null)
const loading = ref(false)

/** 设备定位观测（代表点 + 历史点散点） */
const geo = ref<DeviceGeoResult>({
  point: null,
  manual: false,
  manualAt: null,
  manualAccuracy: null,
  samples: 0,
  history: [],
  lastAt: null,
})

/**
 * 地图打点：代表点用主 marker，历史观测用淡色小点。
 * 这么做是因为同一设备被不同人反复扫，坐标会在几十米范围内漂移，
 * 只画最新一点看不出「这台设备一直在这一带被扫到」这个事实。
 *
 * 🔴 人工点必须与自动点**视觉可区分**（橙色 callout + 「人工」标签 + 更大尺寸），
 * 否则用户分不清哪个是自己标的、哪个是机器猜的，会误判数据可信度。
 *
 * 🔴 `history` 由 geo.ts 保证**已剔除代表点**，所以这里**全量遍历、无需 slice(1)**。
 * 旧代码的 slice(1) 假设「第 0 条是代表点」，在「先扫码 camera、后人工修正 manual」
 * 时会漏画最近那次真实扫码点，并把人工点画两遍（28px 主 marker + 10px 淡点）。
 */
const geoMarkers = computed<MiniMapMarker[]>(() => {
  const p = geo.value.point
  const out: MiniMapMarker[] = []
  geo.value.history.forEach((h, i) => {
    if (!isUsable(h.latitude, h.longitude)) return
    out.push({
      id: 1000 + i,
      latitude: h.latitude,
      longitude: h.longitude,
      opacity: 0.45,
      width: 10,
      height: 10,
    })
  })
  if (p && isUsable(p.latitude, p.longitude)) {
    const manual = geo.value.manual
    out.unshift({
      id: 1,
      latitude: p.latitude,
      longitude: p.longitude,
      title: code.value,
      label: manual ? '人工' : '最新',
      alwaysShow: true,
      width: manual ? 28 : 24,
      height: manual ? 28 : 24,
      callout: manual
        ? {
            display: 'ALWAYS',
            content: '人工修正',
            color: '#ffffff',
            bgColor: '#ff7d45',
            fontSize: 11,
            borderRadius: 4,
            padding: 4,
            textAlign: 'center',
          }
        : undefined,
    })
  }
  return out
})

/** 精度圆：把误差范围画出来，别让人把一个点当成精确定位。
 *
 *  ⚠️ 人工选点若**没有 accuracy**（新写入的人工记录都是null）不画圈 —— 画个假圈反而误导；
 *  ⚠️ 但线上存在**带 accuracy 的旧 manual 记录**（最大一条 1134 米），那种必须画圈：
 *  「因为是人工点所以一律不画圈」会让一条已知标错的数据看起来像精确定位（QA P1-3）。
 *  半径统一截到500m 封顶，避免一个公里级的圈把整张地图视野拉飞。
 */
const geoCircles = computed<MiniMapCircle[]>(() => {
  const p = geo.value.point
  if (!p) return []
  if (!isUsable(p.latitude, p.longitude)) return []
  const r = Number(p.accuracy || 0)
  if (!(r > 0)) return []
  return [
    {
      id: 1,
      latitude: p.latitude,
      longitude: p.longitude,
      radius: Math.min(r, 500),
      color: geo.value.manual ? 'rgba(255,125,69,0.5)' : 'rgba(25,137,250,0.5)',
      fillColor: geo.value.manual ? 'rgba(255,125,69,0.15)' : 'rgba(25,137,250,0.15)',
    },
  ]
})

/** 后端返回裸 UTC（无 Z），按北京时间显示（与项目其它页一致） */
function fmtTime(s?: string | null) {
  if (!s) return ''
  let t = String(s)
  if (!/[Zz]$/.test(t)) t += 'Z'
  const d = new Date(t)
  if (isNaN(d.getTime())) return String(s).slice(0, 16)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

const serialNo = computed(() => {
  const bm = detail.value?.fixed_asset?.brand_model
  return bm ? extractSerialNo(bm) : ''
})
const qrContent = computed(() => `https://www.xmgl-123.cn/ops/qr/${encodeURIComponent(code.value || 'X')}`)

/** 临时编号（TMP- 前缀）：拿到正式编号前不能当固定资产编号用，故顶部红条常驻提示 */
const isTempCode = computed(() => (code.value || '').toUpperCase().startsWith('TMP-'))
const showRebind = ref(false)
const rebindCode = ref('')
const rebindSaving = ref(false)

function openRebind() {
  rebindCode.value = ''
  showRebind.value = true
}

/**
 * 提交补录：后端在一个事务里改写全部关联列（资料记录/档案/照片/观测/盘点/BA/配件/别名/关联边/工单）。
 *
 * 🔴 成功后必须**用新号重新加载**：旧号在库里已不存在，继续用旧号查询会得到空页，
 *    用户会以为「补录把设备弄丢了」。
 */
async function submitRebind() {
  if (rebindSaving.value) return
  const nc = (rebindCode.value || '').trim()
  if (!nc) { showToast('请输入新编号', 'none'); return }
  if (nc.length > 64) { showToast('编号过长（上限 64 字符）', 'none'); return }
  if (nc.toUpperCase().startsWith('TMP-')) { showToast('不能用临时编号作为正式编号', 'none'); return }
  const did = detail.value?.device?.id
  if (did == null) { showToast('该设备缺少台账主键，无法补录', 'none'); return }
  rebindSaving.value = true
  try {
    const r = await assetRebindDeviceCode(did, nc)
    showRebind.value = false
    code.value = r.new_code
    showToast('已补录为 ' + r.new_code, 'success')
    await load()
    loadGeo()
    loadRelations()
  } catch (e: any) {
    // 409 = 新编号已被占用（后端说明被谁占了）；500 = 已整体回滚，数据一处都没改
    showToast((e?.message || '').trim() || '补录失败，请稍后重试', 'none', 2500)
  } finally {
    rebindSaving.value = false
  }
}

/** 空态引导：带着当前编号去建档 */
function goCreate() {
  uni.navigateTo({
    url: `/pages/asset/DeviceCreate?code=${encodeURIComponent(code.value || '')}`,
  })
}

onLoad((opts: any) => {
  const c = (opts?.code || '').trim()
  if (!c) {
    showToast('缺少设备编号', 'none')
    return
  }
  code.value = c
  load()
  loadGeo()
  loadRelTypes()
  loadRelations()
})

async function load() {
  loading.value = true
  try {
    const d = await assetLedgerDetail(code.value)
    // 「回路标注明细」是图纸文字标注图元（LBL-*），不是实体对象 —— 与 Web 端同口径隐藏，
    // 避免小程序与网页看到的关联数据不一致
    if (d?.relations) d.relations = stripCircuitLabelRelations(d.relations)
    detail.value = d
  } catch {
    showToast('加载失败', 'none')
    detail.value = null
  } finally {
    loading.value = false
  }
}

/**
 * 定位观测与台账详情**并行且互不依赖**：
 * 定位失败/无记录只是地图空态，不能连带把设备详情也拖成加载失败。
 */
async function loadGeo() {
  try {
    geo.value = await deviceGeo(code.value, 20)
  } catch {
    // 静默：地图退化为空态，设备主体功能不受影响
    geo.value = {
      point: null,
      manual: false,
      manualAt: null,
      manualAccuracy: null,
      samples: 0,
      history: [],
      lastAt: null,
    }
  }
}

/**
 * 🔴 人工标注的「标了多久」——**实时计算**（fmtAgo 内部取 Date.now()，不写死）。
 * 人工点不设有效期（用户拍板：永不过期），所以唯一让用户自己判断可信度的手段
 * 就是把这个时间差明晃晃摆出来。
 */

// ===== 设备关联（相互关联 + 上下游）=====
const relTypes = ref<AssetRelationType[]>([])
const edges = ref<AssetDeviceLinkEdge[]>([])
const relTab = ref<'mutual' | 'chain'>('mutual')
const relLoading = ref(false)
const relError = ref('')

const showAdd = ref(false)
const addTab = ref<'mutual' | 'chain'>('mutual')
const addType = ref('')
const addOther = ref('')
const addSaving = ref(false)

const mutualTypeOptions = computed(() => relTypes.value.filter((t) => t.direction !== 'forward'))
const chainTypeOptions = computed(() => relTypes.value.filter((t) => t.direction === 'forward'))
const dirOf = computed(() => {
  const m: Record<string, string> = {}
  relTypes.value.forEach((t) => (m[t.label] = t.direction))
  return m
})

// 目标类型：设备（原有）/ 房间（新增，用于登记「供电归属」，不给房间虚拟建设备）
const targetKind = ref<'device' | 'room'>('device')
const roomKw = ref('')
const roomHits = ref<AssetRoomHit[]>([])
const roomSearching = ref(false)
let roomTimer: ReturnType<typeof setTimeout> | null = null

/** 房间模式只能选供电类关系（后端同样限制），默认「供电归属」 */
const roomTypeOptions = computed(() =>
  relTypes.value.filter((t) => (t.kind || '') === 'power'),
)

/** 当前弹层实际可选的类型列表（设备模式看 tab，房间模式只看供电类） */
const addTypeList = computed(() =>
  targetKind.value === 'room'
    ? roomTypeOptions.value
    : (addTab.value === 'mutual' ? mutualTypeOptions.value : chainTypeOptions.value),
)

/** picker 的 :value —— 本项目硬规则：不绑会在打开时触发 change 清空选择 */
const typePickerIndex = computed(() => {
  const i = addTypeList.value.findIndex((t) => t.label === addType.value)
  return i < 0 ? 0 : i
})

function setTargetKind(k: 'device' | 'room') {
  if (targetKind.value === k) return
  targetKind.value = k
  addOther.value = ''
  roomKw.value = ''
  roomHits.value = []
  if (k === 'room') {
    addTab.value = 'chain'
    addType.value =
      roomTypeOptions.value.find((t) => t.label === '供电归属')?.label ||
      roomTypeOptions.value[0]?.label || '供电归属'
  } else {
    addType.value = chainTypeOptions.value[0]?.label || mutualTypeOptions.value[0]?.label || ''
  }
}

function onRoomInput(e: any) {
  roomKw.value = (e.detail.value || '').trim()
  // 关键词一变就作废此前选中的房间：否则「搜了新词但没点选」会按旧房间静默提交，
  // 现场就会把「供电归属」登记到错误的房间上（数据写错比提示多一步贵得多）。
  if (addOther.value) addOther.value = ''
  if (roomTimer) clearTimeout(roomTimer)
  roomTimer = setTimeout(() => { void searchRooms() }, 300)
}

async function searchRooms() {
  const kw = roomKw.value
  if (!kw) { roomHits.value = []; return }
  roomSearching.value = true
  try {
    const rows = await assetRoomSearch(kw, 20)
    roomHits.value = rows || []
  } catch {
    roomHits.value = []
  } finally {
    roomSearching.value = false
  }
}

function pickRoom(r: AssetRoomHit) {
  addOther.value = r.code
  roomKw.value = r.address || r.code
  roomHits.value = []
}

const mutualRels = computed(() =>
  edges.value.filter((e) => (dirOf.value[e.relation_type] ?? 'none') !== 'forward'))
const chainRels = computed(() =>
  edges.value.filter((e) => dirOf.value[e.relation_type] === 'forward'))

function relOtherCode(e: AssetDeviceLinkEdge): string {
  return e.other_code || (e.direction === 'out' ? e.to_code : e.from_code)
}
function relDirectionTag(e: AssetDeviceLinkEdge): string {
  if (dirOf.value[e.relation_type] === 'forward') return e.direction === 'out' ? '上游' : '下游'
  return ''
}
function relSourceTag(e: AssetDeviceLinkEdge): string {
  return e.source === 'auto' ? '自动' : e.source === 'manual' ? '人工' : ''
}
function relOtherName(e: AssetDeviceLinkEdge): string {
  // 房间端点优先显示物理地址（楼栋·楼层·房间名）：光有房间编号现场认不出是哪间房
  if (e.other_kind === 'room') return e.other_address || e.other_name || '房间'
  return e.other_name || ''
}

async function loadRelTypes() {
  try { relTypes.value = await assetRelationTypes() } catch { relTypes.value = [] }
}
async function loadRelations() {
  relLoading.value = true
  relError.value = ''
  try {
    const r = await assetDeviceLink(code.value)
    if (r && r.edges) { edges.value = r.edges; return }
    // 兜底：仅资料表设备的 404
    const [a, b] = await Promise.all([
      assetRelations({ from_code: code.value }),
      assetRelations({ to_code: code.value }),
    ])
    const map = new Map<number, DeviceRelationItem>()
    a.concat(b).forEach((e) => map.set(e.id, e))
    edges.value = Array.from(map.values()).map((e) => ({
      id: e.id, from_code: e.from_code, to_code: e.to_code,
      relation_type: e.relation_type, direction: e.from_code === code.value ? 'out' : 'in',
      source: (e.meta && (e.meta as any).source) || 'manual', other_code: '', other_kind: '',
    }))
  } catch (e: any) {
    relError.value = e?.message || '关联加载失败'
  } finally { relLoading.value = false }
}

function openAdd(tab: 'mutual' | 'chain') {
  addTab.value = tab
  targetKind.value = 'device'
  roomKw.value = ''
  roomHits.value = []
  addType.value = tab === 'mutual'
    ? (mutualTypeOptions.value[0]?.label || '关联')
    : (chainTypeOptions.value[0]?.label || '')
  addOther.value = ''
  showAdd.value = true
}
function onTypePick(e: any) {
  const item = addTypeList.value[Number(e.detail.value)]
  if (item) addType.value = item.label
}
async function scanOther() {
  try {
    const r: any = await uni.scanCode({ onlyFromCamera: false })
    if (r && r.result) addOther.value = parseScanPayload(r.result) || r.result
  } catch { /* 取消扫码，静默 */ }
}
async function submitAdd() {
  const other = (addOther.value || '').trim()
  if (targetKind.value === 'room' && !other) {
    showToast('请先搜索并选择目标房间', 'none'); return
  }
  if (!other) { showToast('请输入或扫码对方设备编号', 'none'); return }
  if (!addType.value) { showToast('请选择关系类型', 'none'); return }
  addSaving.value = true
  try {
    await assetCreateRelation({ from_code: code.value, to_code: other, relation_type: addType.value })
    showToast('关联已添加', 'success')
    showAdd.value = false
    await loadRelations()
  } catch (e: any) {
    showToast(e?.message || '添加失败', 'none')
  } finally { addSaving.value = false }
}
async function removeRel(id: number) {
  try {
    await assetDeleteRelation(id)
    showToast('关联已删除', 'success')
    await loadRelations()
  } catch (e: any) {
    showToast(e?.message || '删除失败', 'none')
  }
}

const manualAgo = computed(() => (geo.value.manual ? fmtAgo(geo.value.manualAt) : ''))

/** 人工标注自带精度且>400 米 → 必须显式警示（线上有一条 1134米的旧记录） */
const manualAccuracyBad = computed(
  () => geo.value.manual && Number(geo.value.manualAccuracy || 0) > 400,
)

/**
 * 手动修正位置：wx.chooseLocation 选点 → 追加一条 scan_source='manual' 的观测。
 *
 * 🔴 铁律：
 * - **用户取消 = 静默返回**，不弹任何错误提示（取消是正常操作，不是失败）；
 * - 选点失败 / 上报失败只提示，**绝不抛出、绝不阻断页面**；
 * - 按钮**不因无坐标而禁用**：从没扫过的设备同样需要能人工标注首个位置；
 * - **必须检查 reportManualDeviceGeo 的返回值**：它返回 false 意味着设备编号为空
 *   或坐标非法、**根本没写进库**。此时若照旧弹「已保存」就是撒谎（QA P2-4）。
 *
 * ⚠️ 并发保护由 chooseLocation 内部的 choosePending 统一负责（QA P2-3）：
 * 页面**不要**自己再置位那个标志，否则会把调用自己挡掉。这里只做入口早退的兜底。
 */
async function onManualFix() {
  if (choosePending.value) return
  const picked = await chooseLocation()
  if (picked.reason === 'cancel' || !picked.point) {
    if (picked.reason && picked.reason !== 'cancel') {
      showToast(chooseFailText(picked.reason), 'none', 1800)
    }
    return
  }
  showToast('保存中…', 'none', 800)
  try {
    const ok = await reportManualDeviceGeo({
      deviceCode: code.value,
      latitude: picked.point.latitude,
      longitude: picked.point.longitude,
      // ⚠️ 设备详情块的台账返回里**没有 room_code 字段**（只有 building/floor），
      // 后端该字段可空，这里传空串即可 —— 不要为凑它去猜房间号。
      roomCode: '',
      operator: operator.value,
    })
    if (!ok) {
      showToast('保存失败：选点无效或设备编号缺失，未写入记录', 'none', 2200)
      return
    }
    await loadGeo()
    showToast('已保存人工修正位置', 'success')
  } catch (e) {
    const msg = (e as { message?: string })?.message || '保存失败，请重试'
    showToast(msg, 'none')
  }
}

function goScanBind() {
  uni.navigateTo({ url: `/pages/print/ScanBind?code=${encodeURIComponent(code.value)}` })
}
function goPrint() {
  setStore('print_prefill_codes', [code.value])
  uni.navigateTo({ url: '/pages/print/DeviceLabelPrint' })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: $tm-bg;
  padding: 24rpx 24rpx calc(env(safe-area-inset-bottom) + 24rpx);
}
.hint {
  text-align: center;
  color: $tm-text-muted;
  font-size: 28rpx;
  padding: 120rpx 0;
}
/* 空态引导建档（扫到码但台账无记录时最常用） */
.create-cta {
  margin: 0 24rpx;
  padding: 28rpx;
  text-align: center;
  background: $tm-primary-bg;
  border-radius: $tm-radius;
}
.c-t {
  display: block;
  font-size: 28rpx;
  color: $tm-text;
  font-weight: 600;
}
.c-d {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  color: $tm-primary;
}
.card {
  background: $tm-card-bg;
  border-radius: $tm-radius;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: $tm-shadow-card;
}
.section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
  margin: 16rpx 8rpx;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24rpx;
  padding: 14rpx 0;
  border-bottom: 1rpx solid $tm-border-light;
}
.row:last-child {
  border-bottom: none;
}
.k {
  font-size: 26rpx;
  color: $tm-text-secondary;
  flex-shrink: 0;
  width: 180rpx;
}
.v {
  flex: 1;
  text-align: right;
  font-size: 26rpx;
  color: $tm-text;
  word-break: break-all;
}
.empty {
  text-align: center;
  color: $tm-text-muted;
  font-size: 26rpx;
}

.qr-card {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.qr-title {
  font-size: 28rpx;
  font-weight: 700;
  color: $tm-text;
  align-self: flex-start;
  margin-bottom: 16rpx;
}
.qr-code {
  margin-top: 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: $tm-primary;
  letter-spacing: 1rpx;
}
.qr-note {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
}

.stats {
  display: flex;
}
.stat {
  flex: 1;
  text-align: center;
}
.num {
  font-size: 36rpx;
  font-weight: 700;
  color: $tm-primary;
}
.lbl {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
}

/* 定位观测元信息 */
.geo-ops {
  margin-top: 20rpx;
}
.geo-btn {
  width: 100%;
  /*QA P2-1：戴手套现场操作，可点高度必须 ≥88rpx（44px），84rpx 只有 42px 会误触 */
  height: 92rpx;
  line-height: 92rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #ff7d45;
  background: #fff7ed;
  border: 1rpx solid #ffbb8a;
  border-radius: 46rpx;
}
.geo-btn::after {
  border: none;
}
.geo-manual-tip {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 16rpx;
  padding: 12rpx 16rpx;
  background: #fff7ed;
  border-radius: $tm-radius-sm;
}
.gmt-flag {
  flex-shrink: 0;
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: #fff;
  background: #ff7d45;
  border-radius: 6rpx;
}
.gmt-txt {
  flex: 1;
  font-size: 22rpx;
  color: #ad4e15;
  line-height: 1.6;
}
/* 🔴 人工标注可信度警示（QA P1-3：不过期，但必须标明「多久前」+「精度多少米」） */
.geo-warn {
  margin-top: 12rpx;
  padding: 14rpx 16rpx;
  background: #fff1e6;
  border: 1rpx solid #ffbb8a;
  border-radius: $tm-radius-sm;
}
.gw-t {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
  color: #ad4e15;
}
.gw-d {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #ad4e15;
  line-height: 1.65;
}
.geo-meta {
  margin-top: 20rpx;
  padding-top: 8rpx;
  border-top: 1rpx solid $tm-border-light;
}
.gm-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12rpx 0;
}
.gm-k {
  font-size: 25rpx;
  color: $tm-text-secondary;
}
.gm-v {
  font-size: 25rpx;
  color: $tm-text;
}
.gm-v.warn {
  color: $tm-warning;
}
.gm-note {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: $tm-text-muted;
  line-height: 1.7;
}

.actions {
  display: flex;
  gap: 20rpx;
  margin-top: 24rpx;
}
.act {
  flex: 1;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 600;
  border: none;
}
.act::after {
  border: none;
}
.act-primary {
  background: $tm-primary;
  color: #fff;
}
.act-outline {
  background: #fff;
  color: $tm-primary;
  border: 1rpx solid $tm-primary;
}
.rel-tabs { display: flex; gap: 16rpx; margin-bottom: 16rpx; }
.rel-tab { flex: 1; text-align: center; height: 72rpx; line-height: 72rpx; font-size: 26rpx;
  color: $tm-text-secondary; background: $tm-bg; border-radius: 36rpx; }
.rel-tab.active { color: #fff; background: $tm-primary; font-weight: 600; }
.rel-head { display: flex; justify-content: space-between; align-items: center; padding: 8rpx 0 12rpx; }
.rel-count { font-size: 24rpx; color: $tm-text-muted; }
.rel-add { font-size: 26rpx; color: $tm-primary; font-weight: 600; }
.rel-empty { text-align: center; color: $tm-text-muted; font-size: 26rpx; padding: 24rpx 0; }
.rel-item { display: flex; flex-wrap: wrap; align-items: center; gap: 16rpx; padding: 18rpx 0;
  border-bottom: 1rpx solid $tm-border-light; }
.rel-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; order: 1; }
.rel-dir { font-size: 22rpx; color: #fff; padding: 2rpx 12rpx; border-radius: 6rpx; }
.rel-dir.out { background: #2f7cf6; }
.rel-dir.in { background: #f0883e; }
.rel-code { font-size: 28rpx; color: $tm-text; font-weight: 600; word-break: break-word; }
.rel-type { font-size: 22rpx; color: $tm-text-secondary; background: $tm-bg;
  padding: 2rpx 10rpx; border-radius: 6rpx; }
.rel-sub { flex: 0 0 100%; padding-left: 0; display: flex; gap: 12rpx; align-items: center; order: 3; }
.rel-name { flex: 1; min-width: 0; font-size: 22rpx; color: $tm-text-muted; }
.rel-src { flex-shrink: 0; white-space: nowrap; font-size: 20rpx; padding: 1rpx 10rpx; border-radius: 6rpx; }
.rel-src.auto { color: #2f7cf6; background: #eaf2ff; }
.rel-src.manual { color: #f0883e; background: #fff1e6; }
.rel-del { font-size: 24rpx; color: #e54848; flex-shrink: 0; padding-left: 12rpx; order: 2; }
.sheet-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 50;
  display: flex; align-items: flex-end; }
.sheet { width: 100%; background: $tm-card-bg; border-radius: 24rpx 24rpx 0 0; padding: 32rpx 24rpx
  calc(env(safe-area-inset-bottom) + 32rpx); }
.sheet-title { font-size: 30rpx; font-weight: 700; color: $tm-text; margin-bottom: 24rpx; }
.sheet-row { display: flex; align-items: center; gap: 16rpx; margin-bottom: 24rpx; }
.sr-k { font-size: 26rpx; color: $tm-text-secondary; width: 150rpx; flex-shrink: 0; }
.sr-picker { flex: 1; }
.sr-pv { height: 80rpx; line-height: 80rpx; background: $tm-bg; border-radius: 12rpx;
  padding: 0 20rpx; font-size: 28rpx; color: $tm-text; }
.sr-inp { flex: 1; height: 80rpx; background: $tm-bg; border-radius: 12rpx; padding: 0 20rpx;
  font-size: 28rpx; color: $tm-text; }
.sr-scan { font-size: 26rpx; color: $tm-primary; font-weight: 600; padding: 0 12rpx; flex-shrink: 0; }
.sheet-ok { height: 88rpx; line-height: 88rpx; text-align: center; border-radius: 44rpx;
  background: $tm-primary; color: #fff; font-size: 30rpx; font-weight: 600; }
.sheet-ok.disabled { opacity: 0.6; }
.sr-seg { flex: 1; display: flex; gap: 12rpx; }
.seg-i {
  flex: 1; height: 68rpx; line-height: 68rpx; text-align: center;
  font-size: 26rpx; color: $tm-text-secondary; background: $tm-bg; border-radius: 12rpx;
}
.seg-i.on { color: #fff; background: $tm-primary; font-weight: 600; }
.room-hits { max-height: 420rpx; overflow-y: auto; margin-bottom: 20rpx; }
.rh-item {
  display: flex; flex-direction: column; padding: 16rpx 18rpx;
  border-bottom: 1rpx solid $tm-border-light;
}
.rh-addr { font-size: 27rpx; color: $tm-text; }
.rh-code { font-size: 22rpx; color: $tm-text-muted; margin-top: 4rpx; }
.room-picked { font-size: 24rpx; color: $tm-success; margin-bottom: 16rpx; }
.room-tip { font-size: 22rpx; color: $tm-text-muted; line-height: 1.6; margin-bottom: 20rpx; }

/* 临时编号红条 */
.tmp-bar {
  background: $tm-danger-bg;
  border: 1rpx solid $tm-danger;
  border-radius: $tm-radius-sm;
  padding: 20rpx 24rpx;
  margin-bottom: 20rpx;
}
.tmp-bar-t {
  font-size: 27rpx;
  font-weight: 600;
  color: $tm-danger;
}
.tmp-bar-d {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: $tm-text-secondary;
}
.tmp-bar-btn {
  margin-top: 14rpx;
  display: inline-block;
  padding: 10rpx 28rpx;
  font-size: 25rpx;
  color: #fff;
  background: $tm-danger;
  border-radius: 30rpx;
}
.rebind-tip {
  margin-top: 12rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: $tm-text-secondary;
}
</style>
