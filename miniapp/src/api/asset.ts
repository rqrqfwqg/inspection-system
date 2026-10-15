/**
 * asset — 设备资产巡检（inspection-system）接口层
 *
 * 本工程（工器具/物料小程序）同时对接两套后端，请勿混用：
 * - 工器具后端：VITE_API_BASE_URL（…/api），走 utils/request（自动带 Bearer、401 跳登录）
 * - 巡检后端　：VITE_ASSET_API_BASE（…/ops/api），即本模块
 *
 * 为什么不复用 utils/request：
 * 1) 基地址不同（同域名、不同路径前缀），且巡检资产接口当前不校验 token
 *    （后续若加鉴权，本模块已统一带 Authorization，无需改页面）；
 * 2) 「设备已归属其他机房」是 HTTP 409，页面要拿到状态码弹「改挂到本房间」确认，
 *    而 utils/request 的错误对象只保留了 message 语义。
 */
import { getToken } from '@/utils/storage'
import type {
  AssetRoom,
  AssetSearchResult,
  AssetRelationType,
  CompleteRoomInventoryPayload,
  CompleteRoomInventoryResult,
  CreateAssetRelationPayload,
  RoomInventoryOverview,
  RoomDevicesResult,
  BindDeviceResult,
  BindDeviceOutcome,
  UndoRoomInventoryResult,
  UnbindDeviceResult,
  DeviceRelationItem,
  AssetDevicePhoto,
  AssetLedgerDetail,
  AssetLedgerListResult,
  AssetResolveResult,
  DeviceSerialObservation,
  CreateObservationPayload,
  CreateObservationResult,
  DeviceGeoObservation,
  GeoObservationPayload,
  AssetSearchProfile,
  AssetPowerChain,
  AssetBaProblem,
  AssetBaProblemsResponse,
  AssetDeviceLinkResult,
  AssetAreaNode,
  AssetAreaStats,
  AssetSubsystem,
  CreateDevicePayload,
  CreatedDevice,
  AssetDataTable,
  AssetTableRecord,
} from '@/types/asset'

/** 巡检后端基地址（生产为 https://www.xmgl-123.cn/ops/api，与工器具同域名） */
const BASE: string = (import.meta.env.VITE_ASSET_API_BASE || 'https://www.xmgl-123.cn/ops/api').replace(/\/+$/, '')

/**
 * 统一错误对象：页面据此区分 404「未找到」、409「归属冲突」与 0「网络异常」。
 * ⚠️ statusCode === 0 专指**请求没到后端**（超时/断网），是离线暂存队列的唯一入队依据。
 */
export interface AssetApiError {
  statusCode: number
  message: string
  data?: any
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** 站点根（照片等静态资源走 /ops/uploads/…，与 API 同源不同前缀） */
const ORIGIN: string = BASE.replace(/\/ops\/api$/, '')

/** 后端存的照片 URL 是相对路径，小程序 <image> 需要绝对地址 */
export function assetPhotoUrl(u: string): string {
  if (!u) return ''
  return /^https?:\/\//.test(u) ? u : `${ORIGIN}${u}`
}

/**
 * 上传头：**绝不能带 Content-Type**。
 * uni.uploadFile 需要自己生成 multipart/form-data 的 boundary，
 * 若手工塞 Content-Type: application/json 会让后端解析不出表单字段。
 */
function uploadHeader(): Record<string, string> {
  const header: Record<string, string> = { 'X-Client-Type': 'miniprogram' }
  const token = getToken()
  if (token) header.Authorization = `Bearer ${token}`
  return header
}

function buildHeader(): Record<string, string> {
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    // 标记来源端，便于后端审计区分「网页 / 小程序」
    'X-Client-Type': 'miniprogram',
  }
  const token = getToken()
  if (token) header.Authorization = `Bearer ${token}`
  return header
}

/** 从后端裸 JSON 提取可读错误信息（FastAPI 用 detail 字段，400 时为数组） */
function extractDetail(data: any, statusCode: number): string {
  if (!data) return `请求失败(${statusCode})`
  if (typeof data === 'string') return data
  const detail = data.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0]
    if (typeof first?.msg === 'string') return first.msg
  }
  if (typeof data.message === 'string' && data.message) return data.message
  return `请求失败(${statusCode})`
}

/** 核心请求（不自带 toast，由页面按场景决定提示方式） */
function assetRequest<T = any>(path: string, method: Method = 'GET', data?: any): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: `${BASE}${path}`,
      method,
      data,
      header: buildHeader(),
      timeout: 15000,
      success: (res) => {
        const statusCode = res.statusCode
        if (statusCode >= 200 && statusCode < 300) {
          resolve(res.data as T)
          return
        }
        reject({
          statusCode,
          message: extractDetail(res.data, statusCode),
          data: res.data,
        } as AssetApiError)
      },
      fail: (err) => {
        const raw = err.errMsg || ''
        // 合法域名没在小程序后台配置 → 请求根本出不去，但 uni.request 也报 fail。
        // 用 -1 与「真网络异常(0)」区分：离线队列只收 0，域名错误当场提示、不入库重试。
        if (raw.includes('not in domain') || raw.includes('url not in domain list') || raw.includes('不在合法域名')) {
          reject({ statusCode: -1, message: '请求失败：请在小程序后台配置 request 合法域名（www.xmgl-123.cn）', data: raw } as AssetApiError)
          return
        }
        const message = raw.includes('timeout') ? '请求超时，请检查网络' : '网络异常，无法连接巡检服务'
        reject({ statusCode: 0, message, data: raw } as AssetApiError)
      },
    })
  })
}

// ===== 机房 / 房间 =====

/** GET /rooms —— 机房全量（可选按楼栋过滤）；盘点选房数据源 */
export function assetRooms(building?: string): Promise<AssetRoom[]> {
  const q = building ? `?building=${encodeURIComponent(building)}` : ''
  return assetRequest<AssetRoom[]>(`/rooms${q}`)
}

/** GET /assets/rooms/inventory/overview —— 各房间已绑定设备数（盘点进度） */
export function assetInventoryOverview(building?: string): Promise<RoomInventoryOverview> {
  const q = building ? `?building=${encodeURIComponent(building)}` : ''
  return assetRequest<RoomInventoryOverview>(`/assets/rooms/inventory/overview${q}`)
}

/** GET /assets/rooms/{roomCode}/devices —— 某房间已盘设备清单 */
export function assetRoomDevices(roomCode: string): Promise<RoomDevicesResult> {
  return assetRequest<RoomDevicesResult>(`/assets/rooms/${encodeURIComponent(roomCode)}/devices`)
}

/**
 * POST /assets/rooms/{roomCode}/devices —— 扫码把设备挂到房间（幂等）。
 * 命中 409 时返回 conflict 对象（设备已归属其他机房），由页面确认是否 move=true 改挂；
 * 其余错误（404 未找到 / 400 参数）原样抛出。
 */
export async function assetBindDevice(
  roomCode: string,
  deviceCode: string,
  move = false,
): Promise<BindDeviceOutcome> {
  try {
    return await assetRequest<BindDeviceResult>(
      `/assets/rooms/${encodeURIComponent(roomCode)}/devices`,
      'POST',
      { device_code: deviceCode, move },
    )
  } catch (e) {
    const err = e as AssetApiError
    if (err.statusCode === 409) {
      // 后端 detail 形如「该设备已归属机房 P12W2F-PDF-102（配电房）」
      const detail = err.message || ''
      const roomCode2 = detail.replace(/^该设备已归属机房\s*/, '').split('（')[0].trim()
      return { conflict: true, room_code: roomCode2, message: detail || '该设备已归属其他机房' }
    }
    throw err
  }
}

// ===== 房间盘点完成（已盘点标记）=====

/**
 * POST /assets/rooms/{roomCode}/inventory/complete —— 标记房间「已盘点」（幂等 upsert）。
 *
 * 空房间（0 台设备）同样可提交：后端记 empty_confirmed=true，语义是
 * 「现场确认该房间无设备」，**不因没有设备绑定而拒绝**。
 * device_count 由后端按绑定口径实时统计后快照，前端不传，避免口径漂移。
 */
export function assetCompleteRoomInventory(
  roomCode: string,
  payload: CompleteRoomInventoryPayload = {},
): Promise<CompleteRoomInventoryResult> {
  return assetRequest<CompleteRoomInventoryResult>(
    `/assets/rooms/${encodeURIComponent(roomCode)}/inventory/complete`,
    'POST',
    { operator: payload.operator || '', remark: payload.remark || '', source: payload.source || 'miniprogram' },
  )
}

/** DELETE /assets/rooms/{roomCode}/inventory/complete —— 撤销「已盘点」（设备绑定不受影响） */
export function assetUndoRoomInventory(roomCode: string): Promise<UndoRoomInventoryResult> {
  return assetRequest<UndoRoomInventoryResult>(
    `/assets/rooms/${encodeURIComponent(roomCode)}/inventory/complete`,
    'DELETE',
  )
}

/** DELETE /assets/rooms/{roomCode}/devices/{deviceCode} —— 解绑（删「所在机房」边 + 清 room_id） */
export function assetUnbindDevice(roomCode: string, deviceCode: string): Promise<UnbindDeviceResult> {
  return assetRequest<UnbindDeviceResult>(
    `/assets/rooms/${encodeURIComponent(roomCode)}/devices/${encodeURIComponent(deviceCode)}`,
    'DELETE',
  )
}

// ===== 现场新建设备（0 命中建档）=====

/** GET /assets/subsystems —— 子系统下拉（新建设备所属系统） */
export function assetSubsystems(): Promise<AssetSubsystem[]> {
  return assetRequest<AssetSubsystem[]>('/subsystems')
}

/** POST /assets/devices —— 现场新建设备（凭空建档；device_code 后端防重） */
export function assetCreateDevice(payload: CreateDevicePayload): Promise<CreatedDevice> {
  return assetRequest<CreatedDevice>('/devices', 'POST', payload)
}

// ===== 设备检索 / 现场建边 =====

/**
 * GET /assets/search?code=&depth= —— 设备聚合检索（设备属性页的主数据源）。
 *
 * 一次返回：target 档案 + profile 画像统计 + **power_chain 上下级链** + problems
 * BA 问题 + aliases 编号别名 + accessories 配件 + groups 资料分组 + edges 关联边。
 *
 * depth 控制供电/冷源链的回溯跳数（后端 clamp 到 1..5，默认 2）。现场希望
 * 「一次看清这台电是从哪来的」时传 3，能多回溯两级。
 */
export function assetSearchDevice(code: string, depth?: number): Promise<AssetSearchResult> {
  const d = Number(depth)
  const q = isFinite(d) && d > 0 ? `&depth=${Math.min(5, Math.max(1, Math.round(d)))}` : ''
  return assetRequest<AssetSearchResult>(`/assets/search?code=${encodeURIComponent(code)}${q}`)
}

/**
 * GET /assets/link/device/{code} —— 单设备联动总览（资料记录分组 + 关联边 + 来源标注）。
 *
 * 相比 /assets/search，它多三件关键信息：**对方设备名称**、对方类型（设备/机房/资料）、
 * 以及每条边是**自动关联还是人工关联**（source / source_label）—— Web 端设备详情
 * 据此把关联关系分列展示。
 *
 * ⚠️ 存在性口径比 /search **窄**：只认 devices / rooms 表，遇「仅存在于资料（records）」
 * 的设备返回 404。这类设备仍应能看属性，故此处**容错降级为 null**，由页面继续用
 * search / detail 的数据渲染。
 */
export async function assetDeviceLink(code: string): Promise<AssetDeviceLinkResult | null> {
  if (!code) return null
  try {
    return await assetRequest<AssetDeviceLinkResult>(
      `/assets/link/device/${encodeURIComponent(code)}`,
    )
  } catch (e) {
    const err = e as AssetApiError
    // 404 = 该编号不在 devices/rooms（仅资料设备），属预期分支，静默降级
    if (err && err.statusCode === 404) return null
    throw e
  }
}

/**
 * GET /assets/ba/problems?device_code= —— 该设备的 BA 问题清单。
 *
 * 字段：problem_type（问题类型）/ location（位置）/ status（open·processing·closed）。
 * 该接口不可用时静默返回空数组 —— BA 区块缺数据不该拖垮整页（与 Web 端同策略）。
 */
export async function assetBaProblems(deviceCode: string): Promise<AssetBaProblem[]> {
  if (!deviceCode) return []
  try {
    const r = await assetRequest<AssetBaProblemsResponse>(
      `/assets/ba/problems?device_code=${encodeURIComponent(deviceCode)}&page_size=100`,
    )
    return Array.isArray(r?.items) ? r.items : []
  } catch {
    return []
  }
}

/** 便捷类型出口：属性页用到的块（避免页面重复写内联结构） */
export type { AssetSearchProfile, AssetPowerChain, AssetBaProblem }

/** GET /assets/relation-types —— 关联类型字典（供电/上级配电/冷源/网络…） */
export function assetRelationTypes(): Promise<AssetRelationType[]> {
  return assetRequest<AssetRelationType[]>('/assets/relation-types')
}

/**
 * GET /assets/relations?from_code=&to_code= —— 设备关联边（含 id，可删除）。
 * ⚠️ 必须带 from_code 或 to_code：后端不带过滤条件会返回全表（实测 998 条）。
 * 设备卡需查两个方向（from=本机 为其下游，to=本机 为其上游）后合并。
 */
export function assetRelations(params: {
  from_code?: string
  to_code?: string
}): Promise<DeviceRelationItem[]> {
  const parts: string[] = []
  if (params.from_code) parts.push(`from_code=${encodeURIComponent(params.from_code)}`)
  if (params.to_code) parts.push(`to_code=${encodeURIComponent(params.to_code)}`)
  const qs = parts.length ? `?${parts.join('&')}` : ''
  return assetRequest<DeviceRelationItem[]>(`/assets/relations${qs}`)
}

/** POST /assets/relations —— 现场建边（两端可传编号/标签号/别名，后端归一 + 防自环） */
export function assetCreateRelation(payload: CreateAssetRelationPayload): Promise<{ id: number }> {
  return assetRequest<{ id: number }>('/assets/relations', 'POST', payload)
}

/** DELETE /assets/relations/{rid} —— 删除一条关联（现场误建纠错） */
export function assetDeleteRelation(rid: number): Promise<{ success: boolean; message?: string }> {
  return assetRequest<{ success: boolean; message?: string }>(`/assets/relations/${rid}`, 'DELETE')
}

// ===== 设备现场照片 =====

/**
 * GET /assets/devices/by-code/{code}/photos —— 按**设备编号**列出现场照片。
 *
 * 为什么不吃 devices.id：现场扫码只有编号，且多数真实设备（仅台账 / 仅 records）
 * 在 devices 表里没有档案、根本没有 id。后端因此提供 by-code 入口，
 * 存在性口径与 /assets/search 的 found 一致。
 */
export function assetDevicePhotos(code: string): Promise<AssetDevicePhoto[]> {
  return assetRequest<AssetDevicePhoto[]>(
    `/assets/devices/by-code/${encodeURIComponent(code)}/photos`,
  )
}

/**
 * POST /assets/devices/by-code/{code}/photos —— 上传一张现场照片（multipart，≤10MB）。
 *
 * statusCode=0 仍专指「请求没到后端」，是离线队列的唯一入队依据。
 */
export function assetUploadDevicePhoto(
  code: string,
  filePath: string,
  note = '',
  createdBy = '',
): Promise<AssetDevicePhoto> {
  return new Promise<AssetDevicePhoto>((resolve, reject) => {
    uni.uploadFile({
      url: `${BASE}/assets/devices/by-code/${encodeURIComponent(code)}/photos`,
      filePath,
      name: 'file',
      formData: { note, created_by: createdBy },
      header: uploadHeader(),
      timeout: 60000,
      success: (res) => {
        let data: any = res.data
        try {
          data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
        } catch {
          /* 非 JSON（如网关错误页）→ 交给下方 extractDetail 兜底 */
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data as AssetDevicePhoto)
          return
        }
        reject({
          statusCode: res.statusCode,
          message: extractDetail(data, res.statusCode),
          data,
        } as AssetApiError)
      },
      fail: (err) => {
        const raw = err.errMsg || ''
        if (raw.includes('not in domain') || raw.includes('url not in domain list') || raw.includes('不在合法域名')) {
          reject({ statusCode: -1, message: '上传失败：请在小程序后台配置 uploadFile 合法域名（www.xmgl-123.cn）', data: raw } as AssetApiError)
          return
        }
        const message = raw.includes('timeout') ? '上传超时，请检查网络' : '网络异常，照片未能上传'
        reject({ statusCode: 0, message, data: raw } as AssetApiError)
      },
    })
  })
}

/** DELETE /assets/photos/{pid} —— 删除现场照片（同时删磁盘文件） */
export function assetDeleteDevicePhoto(pid: number): Promise<{ success: boolean; message?: string }> {
  return assetRequest<{ success: boolean; message?: string }>(`/assets/photos/${pid}`, 'DELETE')
}

// ===== 资产总台账：全字段详情 / 机身编码反查 =====

/**
 * GET /assets/asset-ledger/detail?code= —— 单设备**所有基础信息**。
 *
 * 一次拿齐：devices 档案 + fixed_assets 固定资产全字段（含品牌型号/机身编号所在的
 * brand_model、序列号、权属单位、使用单位、合同号、责任人、保修到期、含税价…）
 * + device_archives 设备档案 + 跨资料表 records + 关联链路。
 *
 * 现场价值：扫码后不用来回切页面，一屏看清这台设备的完整底账。
 */
export function assetLedgerDetail(code: string): Promise<AssetLedgerDetail> {
  return assetRequest<AssetLedgerDetail>(`/assets/asset-ledger/detail?code=${encodeURIComponent(code)}`)
}

/**
 * GET /assets/asset-ledger?q= —— 按关键词反查总台账（跨字段模糊匹配）。
 *
 * 后端 _QUERY_FIELDS 覆盖 device_code / asset_name / **brand_model** / serial_no /
 * asset_code / location / contract_no…，因此**铭牌上的机身编号**（如 G-1D9APt，
 * 嵌在 brand_model 文本里）可以直接搜到对应设备。
 *
 * 场景：现场没条码可扫 / 扫码失败时，作业员照着铭牌手输机身编号就能找到设备。
 */
export function assetMatchLedger(q: string, pageSize = 12, page = 1): Promise<AssetLedgerListResult> {
  const size = Math.max(1, Math.min(Number(pageSize) || 12, 50))
  const p = Math.max(1, Math.round(Number(page) || 1))
  return assetRequest<AssetLedgerListResult>(
    `/assets/asset-ledger?q=${encodeURIComponent(q)}&page_size=${size}&page=${p}`,
  )
}

/**
 * GET /assets/asset-ledger/resolve?q=&limit= —— 统一机身编码/设备编号解析（只读 · 权威匹配内核）。
 *
 * 这是**唯一**的匹配判定入口：返回 kind（device_code / alias / serial / serial_no / fuzzy /
 * none / ambiguous）与按可信度排序的候选，前端只展示、不重排、不据格式猜。
 * 相比 assetMatchLedger 的模糊搜索：resolve 有精确层优先、R1 降权、R2 歧义判定、R3
 * 剔除 device_code 撞车，是防止「输入恰好撞上另一台设备编号 → 静默误绑」的权威依据。
 */
export function assetResolveCode(q: string, limit = 8): Promise<AssetResolveResult> {
  const n = Math.max(1, Math.min(Number(limit) || 8, 20))
  return assetRequest<AssetResolveResult>(
    `/assets/asset-ledger/resolve?q=${encodeURIComponent(q)}&limit=${n}`,
  )
}

// ===== 机身编号现场补录（L2 观测层 · 只增不改台账）=====

/**
 * POST /assets/asset-ledger/observations —— 现场补录一条机身编号观测（幂等）。
 *
 * 语义：
 * - 幂等：同一 device_code + 归一后的 serial_raw 重复提交 → `already:true`（不是失败）；
 * - `conflict_state='none'` 正常；`conflicts_ledger`（与台账 brand_model 不一致，并存待复核，
 *   **台账未被修改**）/ `conflicts_other_device`（该编号已被其他设备观测过，未并入匹配）；
 * - 400：serial_raw 归一后为空；404：device_code 不在台账 —— 均为业务错误，当场提示、不入离线队列。
 * 请求头已由 buildHeader() 统一带 `X-Client-Type: miniprogram`。
 */
export function assetCreateObservation(
  payload: CreateObservationPayload,
): Promise<CreateObservationResult> {
  return assetRequest<CreateObservationResult>('/assets/asset-ledger/observations', 'POST', {
    device_code: payload.device_code,
    serial_raw: payload.serial_raw,
    room_code: payload.room_code || '',
    operator: payload.operator || '',
    observed_at: payload.observed_at || '',
    note: payload.note || '',
    evidence_photo_id: payload.evidence_photo_id ?? null,
  })
}

/** GET /assets/asset-ledger/observations?device_code= —— 某设备的现场补录列表 */
export function assetListObservations(deviceCode: string): Promise<DeviceSerialObservation[]> {
  return assetRequest<DeviceSerialObservation[]>(
    `/assets/asset-ledger/observations?device_code=${encodeURIComponent(deviceCode)}`,
  )
}

/** DELETE /assets/asset-ledger/observations/{id} —— 软删（status='rejected'），台账不受影响 */
export function assetDeleteObservation(
  id: number,
): Promise<{ success: boolean; id?: number; status?: string; message?: string }> {
  return assetRequest<{ success: boolean; id?: number; status?: string; message?: string }>(
    `/assets/asset-ledger/observations/${id}`,
    'DELETE',
  )
}

// ===== 工具 =====

/**
 * 扫码内容 → 设备编号。
 *
 * 标签二维码内容是直达链接 `…/ops/qr/<encodeURIComponent(编号)>`（见 Web 端二维码打印页），
 * uni.scanCode 会返回整条 URL；本函数同时兼容现场手输的纯编号与 /qr/xxx 相对路径。
 */
export function parseScanPayload(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return ''
  const m = /[/#]qr\/([^?#\s]+)/.exec(s)
  if (m) {
    try {
      return decodeURIComponent(m[1]).trim()
    } catch {
      return m[1].trim()
    }
  }
  return s
}

// ===== 设备现场定位观测（批次⑤ · 扫码即记坐标）=====

/**
 * POST /assets/asset-ledger/geo-observations —— 上报一条扫码时取到的设备定位。
 *
 * 语义：
 * - **每次扫码一条**（与补录的幂等语义不同）：同一设备多次扫码保留多条历史，
 *   用于判断设备是否被移动过、交叉验证定位漂移；
 * - 400：经纬度缺失/超范围/为 (0,0)；404：device_code 不在台账 ——
 *   均为业务错误，当场提示、**不入离线队列**（重试无意义）；
 * - **定位没取到就不要调用本函数**（由调用方判断），绝不塞 (0,0) 假坐标污染数据。
 */
export function assetCreateGeoObservation(
  payload: GeoObservationPayload,
): Promise<{ success: boolean; id: number; device_code: string; created: boolean }> {
  return assetRequest('/assets/asset-ledger/geo-observations', 'POST', {
    device_code: payload.device_code,
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracy: payload.accuracy ?? null,
    altitude: payload.altitude ?? null,
    coord_type: payload.coord_type || 'gcj02',
    room_code: payload.room_code || '',
    scan_source: payload.scan_source || 'camera',
    operator: payload.operator || '',
    observed_at: payload.observed_at || '',
  })
}

/**
 * GET /assets/asset-ledger/geo-observations?device_code=&limit= —— 定位观测（最新在前）
 *
 * 🔴 `deviceCode` 传空串 = **不按设备过滤**，返回最近 limit 条（用于按 room_code
 * 自行聚合的场景）。后端对空值本就不过滤，这里只是别把 `device_code=` 省掉，
 * 让「不过滤」和「过滤空设备」两种意图在调用侧就分清。
 *
 * limit 上限与后端一致为 200 —— 房间聚合要一次取窗口，硬夹到 50 会静默漏数据。
 */
export function assetListGeoObservations(
  deviceCode: string,
  limit = 5,
): Promise<DeviceGeoObservation[]> {
  const n = Math.max(1, Math.min(Number(limit) || 5, 200))
  const code = (deviceCode || '').trim()
  const qs = code
    ? `device_code=${encodeURIComponent(code)}&limit=${n}`
    : `limit=${n}`
  return assetRequest<DeviceGeoObservation[]>(
    `/assets/asset-ledger/geo-observations?${qs}`,
  )
}

// ===== 设备管理页（区域树 / 区域概览）=====

/**
 * GET /assets/trees/area —— 区域树**懒加载**（楼栋 → 楼层 → 房间类型 → 机房 → 设备）。
 *
 * 不传 parent 取根（楼栋列表）；展开某个节点时，把该节点返回的 key **原样**作为 parent
 * 传回 —— 不要在前端自己拼 key：中间层含中文与冒号，拼错后端匹配不到、会静默返回空数组。
 *
 * only_with_devices=true 可剪掉 0 台设备的空分支（设备管理页默认开，避免点进空楼层）。
 * 根节点的 count 是**真实归属**设备数（不含固定资产 fuzzy 归属），meta.asset_pending 单独提示待核实。
 */
export function assetAreaTree(
  params: {
    parent?: string
    keyword?: string
    only_with_devices?: boolean
    group_by_type?: boolean
  } = {},
): Promise<AssetAreaNode[]> {
  const q: string[] = []
  if (params.parent) q.push(`parent=${encodeURIComponent(params.parent)}`)
  if (params.keyword) q.push(`keyword=${encodeURIComponent(params.keyword)}`)
  if (params.only_with_devices) q.push('only_with_devices=true')
  if (params.group_by_type === false) q.push('group_by_type=false')
  return assetRequest<AssetAreaNode[]>(`/assets/trees/area${q.length ? `?${q.join('&')}` : ''}`)
}

/** GET /assets/areas/stats —— 区域概览（设备总数 / 机房数 / 有设备机房间数） */
export function assetAreaStats(): Promise<AssetAreaStats> {
  return assetRequest<AssetAreaStats>('/assets/areas/stats')
}

// ===== 数据表（批量打印「从数据表导入」源）=====

/**
 * GET /assets/tables —— 数据表清单（含 record_count，可筛出有设备的表）。
 *
 * 用于批量打印页「从数据表导入」：选一张表 → 拉该表记录 → 多选设备加入打印清单。
 * 现场新建设备（site_created_devices）也是其中一张表，故「既能导入现场新建、
 * 也能在数据表管理里选表选设备」统一走本接口。
 */
export function assetDataTables(): Promise<AssetDataTable[]> {
  return assetRequest<AssetDataTable[]>('/tables')
}

/**
 * GET /assets/tables/{tid}/records —— 某数据表的记录（裸数组，limit 缺省=全部）。
 *
 * 记录结构（已实测）：`device_code` 与 `device_name` 在顶层，`brand_model` 在 `data` 内，
 * 故抽取机身编号走 `extractSerialNo(record.data.brand_model)`；打印目标用 `device_code`。
 */
export function assetTableRecords(
  tid: number,
  params: { limit?: number; skip?: number; q?: string; device_code?: string } = {},
): Promise<AssetTableRecord[]> {
  const q: string[] = []
  if (params.limit) q.push(`limit=${params.limit}`)
  if (params.skip) q.push(`skip=${params.skip}`)
  if (params.q) q.push(`q=${encodeURIComponent(params.q)}`)
  if (params.device_code) q.push(`device_code=${encodeURIComponent(params.device_code)}`)
  return assetRequest<AssetTableRecord[]>(`/tables/${tid}/records${q.length ? '?' + q.join('&') : ''}`)
}
