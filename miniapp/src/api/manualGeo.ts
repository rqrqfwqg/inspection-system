/**
 * manualGeo —— **人工选点的本机暂存层（兼容兜底用）**（房间位置 / 线路节点位置）
 *
 * 🔴 现状（2026-10-22 起）：房间 / 线路节点的人工选点**已落库**到后端的
 * `device_geo_observations`（room_code + scan_source='manual'，ROOM:: 哨兵记录，
 * 班组共享、换设备不丢）。`RoomDetail` / `RouteDetail` 的标注与清除都已走
 * `assetCreateGeoObservation` / `assetDeleteGeoObservation`。
 *
 * 本模块仅保留为**旧版本机标注的兼容兜底**：升级前在 A 手机本机标过的点，
 * 后端查不到时回落到这里读取；新标注一律只写后端，不再写本机。
 *
 * key 命名统一 `manual_` 前缀区分来源，绝不与后端同步类 key 混用：
 *   - `manual_room_geo_<roomCode>`
 *   - `manual_route_node_geo_<routeId>_<nodeId>`
 */
import { getJSON, set as setStore, remove as removeStore } from '@/utils/storage'
import { isUsable } from '@/api/geo'

/** 一条人工标注（本机存储结构） */
export interface ManualGeoPoint {
  latitude: number
  longitude: number
  /** 用户选的地点名（wx.chooseLocation 返回，可能为空） */
  name?: string
  address?: string
  /** 标注时间（本地时钟，毫秒） */
  at: number
  /** 标注人（仅本机可见，用于「谁标的」追溯） */
  operator?: string
}

/** 房间位置本机 key */
function roomKey(roomCode: string): string {
  return `manual_room_geo_${roomCode}`
}

/** 线路节点位置本机 key（nodeId 是节点主键，天然区分同房间的多个节点） */
function nodeKey(routeId: number | string, nodeId: number | string): string {
  return `manual_route_node_geo_${routeId}_${nodeId}`
}

/** 校验并规范化一条人工标注；非法（含 (0,0)）返回 null —— 绝不返回假坐标 */
function normalize(p: Partial<ManualGeoPoint> | null | undefined): ManualGeoPoint | null {
  if (!p) return null
  const lat = Number(p.latitude)
  const lng = Number(p.longitude)
  if (!isUsable(lat, lng)) return null
  return {
    latitude: lat,
    longitude: lng,
    name: String(p.name || ''),
    address: String(p.address || ''),
    at: Number(p.at) || Date.now(),
    operator: String(p.operator || ''),
  }
}

/** 读房间人工标注；无记录 / 记录非法一律返回 null（调用方回落自动推算值） */
export function getManualRoomGeo(roomCode: string): ManualGeoPoint | null {
  const code = (roomCode || '').trim()
  if (!code) return null
  return normalize(getJSON<ManualGeoPoint>(roomKey(code)))
}

/** 写房间人工标注（本机） */
export function setManualRoomGeo(roomCode: string, p: ManualGeoPoint): boolean {
  const code = (roomCode || '').trim()
  const v = normalize(p)
  if (!code || !v) return false
  setStore(roomKey(code), v)
  return true
}

/** 清除房间人工标注（用户标错后撤销） */
export function clearManualRoomGeo(roomCode: string): void {
  const code = (roomCode || '').trim()
  if (!code) return
  removeStore(roomKey(code))
}

/** 读线路节点人工标注 */
export function getManualNodeGeo(
  routeId: number | string,
  nodeId: number | string,
): ManualGeoPoint | null {
  if (!routeId || !nodeId) return null
  return normalize(getJSON<ManualGeoPoint>(nodeKey(routeId, nodeId)))
}

/** 写线路节点人工标注（本机） */
export function setManualNodeGeo(
  routeId: number | string,
  nodeId: number | string,
  p: ManualGeoPoint,
): boolean {
  const v = normalize(p)
  if (!routeId || !nodeId || !v) return false
  setStore(nodeKey(routeId, nodeId), v)
  return true
}

/** 清除单个线路节点的人工标注 */
export function clearManualNodeGeo(routeId: number | string, nodeId: number | string): void {
  if (!routeId || !nodeId) return
  removeStore(nodeKey(routeId, nodeId))
}

/** 「人工标注 · 时间」小字（落库后无需强调本机；保留操作人与时间便于追溯） */
export function manualGeoHint(p?: ManualGeoPoint | null): string {
  if (!p) return ''
  const d = new Date(p.at)
  if (isNaN(d.getTime())) return '人工标注'
  const pad = (n: number) => String(n).padStart(2, '0')
  const when = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `人工标注${p.operator ? '· ' + p.operator : ''} ${when}`
}