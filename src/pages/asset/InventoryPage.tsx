import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  scanRooms,
  scanInventoryOverview,
  scanRoomDevices,
  scanBindDeviceToRoom,
  scanUnbindDeviceFromRoom,
} from '@/features/scan/api'
import type {
  ScanRoom,
  RoomInventoryOverview,
  RoomBrief,
  InventoryDeviceRow,
} from '@/features/scan/types'
import { ScanInput } from '@/components/scan/ScanInput'
import { cn } from '@/lib/utils'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ClipboardList,
  MapPin,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'

const MAX_ROOM_ROWS = 80

type ScanStatus = 'ok' | 'dup' | 'moved' | 'conflict' | 'missing'
interface ScanLogItem {
  key: string
  code: string
  status: ScanStatus
  name?: string
  detail?: string
}

const LOG_STYLE: Record<ScanStatus, string> = {
  ok: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  dup: 'text-amber-700 bg-amber-50 border-amber-200',
  moved: 'text-purple-700 bg-purple-50 border-purple-200',
  conflict: 'text-red-700 bg-red-50 border-red-200',
  missing: 'text-red-700 bg-red-50 border-red-200',
}
const LOG_LABEL: Record<ScanStatus, string> = {
  ok: '已绑定',
  dup: '已在清单',
  moved: '已改挂',
  conflict: '归属冲突',
  missing: '未找到设备',
}

/**
 * /ops/asset/inventory —— 扫码盘点（房间 ↔ 设备，一对多）。
 *
 * 流程：选房间 → 连续扫码 → 设备自动绑定到该房间。
 * 落点复用既有结构（不新建表）：device_relations 的「所在机房」边
 * （from_code = 设备编号 → to_code = 房间编号）+ devices.room_id/building/floor 回填，
 * 因此绑定后 /asset-viz 的机房区域树与区域统计立即生效。
 *
 * 一台设备只归属一间房：扫到已属其他房间的设备会提示冲突，确认后改挂。
 */
export default function InventoryPage() {
  const { toast } = useToast()

  const [rooms, setRooms] = React.useState<ScanRoom[]>([])
  const [overview, setOverview] = React.useState<RoomInventoryOverview | null>(null)
  const [loadingBase, setLoadingBase] = React.useState(true)

  // 房间筛选
  const [building, setBuilding] = React.useState('')
  const [floor, setFloor] = React.useState('')
  const [query, setQuery] = React.useState('')

  // 当前盘点房间
  const [current, setCurrent] = React.useState<RoomBrief | null>(null)
  const [devices, setDevices] = React.useState<InventoryDeviceRow[]>([])
  const [count, setCount] = React.useState(0)
  const [loadingRoom, setLoadingRoom] = React.useState(false)

  // 本次扫码日志 + 冲突待确认
  const [log, setLog] = React.useState<ScanLogItem[]>([])
  const [conflict, setConflict] = React.useState<{ code: string; roomCode: string; message: string } | null>(null)
  const [pendingRemove, setPendingRemove] = React.useState<string | null>(null)

  // ---------- 基础数据 ----------
  const loadBase = React.useCallback(async () => {
    setLoadingBase(true)
    try {
      const [rs, ov] = await Promise.all([scanRooms(), scanInventoryOverview()])
      setRooms(rs)
      setOverview(ov)
    } catch (e) {
      toast({ title: '加载失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoadingBase(false)
    }
  }, [toast])

  React.useEffect(() => {
    void loadBase()
  }, [loadBase])

  const countByRoom = React.useMemo(() => {
    const m = new Map<string, number>()
    overview?.rooms.forEach((r) => m.set(r.code, r.device_count))
    return m
  }, [overview])

  const activeRooms = React.useMemo(() => rooms.filter((r) => r.is_active !== false), [rooms])
  const buildings = React.useMemo(
    () => Array.from(new Set(activeRooms.map((r) => r.building).filter(Boolean))).sort(),
    [activeRooms],
  )
  const floors = React.useMemo(
    () =>
      Array.from(
        new Set(activeRooms.filter((r) => r.building === building).map((r) => r.floor).filter(Boolean)),
      ).sort(),
    [activeRooms, building],
  )
  const filteredRooms = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = activeRooms.filter(
      (r) =>
        (!building || r.building === building) &&
        (!floor || r.floor === floor) &&
        (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)),
    )
    return out.sort((a, b) => {
      const d = (countByRoom.get(b.code) ?? 0) - (countByRoom.get(a.code) ?? 0)
      return d !== 0 ? d : a.code.localeCompare(b.code)
    })
  }, [activeRooms, building, floor, query, countByRoom])

  const shownRooms = filteredRooms.slice(0, MAX_ROOM_ROWS)

  // ---------- 选择 / 切换房间 ----------
  const pickRoom = React.useCallback(async (room: RoomBrief) => {
    setCurrent(room)
    setLog([])
    setConflict(null)
    setPendingRemove(null)
    setLoadingRoom(true)
    setDevices([])
    setCount(0)
    try {
      const res = await scanRoomDevices(room.code)
      setDevices(res.devices)
      setCount(res.count)
    } catch (e) {
      toast({ title: '房间清单加载失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoadingRoom(false)
    }
  }, [toast])

  const pushLog = React.useCallback((item: Omit<ScanLogItem, 'key'>) => {
    setLog((prev) => [{ ...item, key: `${Date.now()}-${Math.random()}` }, ...prev].slice(0, 30))
  }, [])

  // ---------- 扫码绑定 ----------
  const bind = React.useCallback(
    async (code: string, move: boolean) => {
      if (!current) return
      try {
        const res = await scanBindDeviceToRoom(current.code, code, move)
        if ('conflict' in res) {
          setConflict({ code, roomCode: res.room_code, message: res.message })
          pushLog({ code, status: 'conflict', detail: res.message })
          return
        }
        setConflict(null)
        setCount(res.count)
        setDevices((prev) => {
          const rest = prev.filter((d) => d.device_code !== res.device.device_code)
          return [...rest, res.device].sort((a, b) => a.device_code.localeCompare(b.device_code))
        })
        if (res.already) {
          pushLog({ code: res.device.device_code, status: 'dup', name: res.device.name })
        } else if (res.moved_from) {
          pushLog({
            code: res.device.device_code,
            status: 'moved',
            name: res.device.name,
            detail: `原属 ${res.moved_from}`,
          })
        } else {
          pushLog({ code: res.device.device_code, status: 'ok', name: res.device.name })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '绑定失败'
        setConflict(null)
        pushLog({ code, status: 'missing', detail: msg })
      }
    },
    [current, pushLog],
  )

  const onScan = React.useCallback(
    async (code: string) => {
      await bind(code, false)
    },
    [bind],
  )

  const confirmMove = React.useCallback(async () => {
    if (!conflict) return
    const { code } = conflict
    setConflict(null)
    await bind(code, true)
  }, [conflict, bind])

  // ---------- 解绑 ----------
  const removeDevice = React.useCallback(
    async (code: string) => {
      if (!current) return
      try {
        const res = await scanUnbindDeviceFromRoom(current.code, code)
        setDevices((prev) => prev.filter((d) => d.device_code !== code))
        setCount(res.count)
        setPendingRemove(null)
        toast({ title: '已解绑', description: code })
      } catch (e) {
        toast({ title: '解绑失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
      }
    },
    [current, toast],
  )

  // ---------- 渲染 ----------
  const pickerPanel = (
    <>
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600" />
            选择要盘点的房间
            <span className="text-xs text-gray-400 font-normal">
              （共 {activeRooms.length} 间，按已绑定设备数排序）
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <select
              value={building}
              onChange={(e) => {
                setBuilding(e.target.value)
                setFloor('')
              }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">全部楼栋</option>
              {buildings.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">全部楼层</option>
              {floors.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <div className="relative col-span-2 md:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索房间号 / 名称"
                className="pl-9 h-10"
              />
            </div>
          </div>

          {loadingBase && <Skeleton className="h-24 w-full" />}

          {!loadingBase && (
            <div className="max-h-[52vh] overflow-auto divide-y divide-gray-100 rounded-md border border-gray-100">
              {shownRooms.length === 0 && (
                <p className="text-sm text-gray-400 p-3">无匹配房间，请调整筛选条件。</p>
              )}
              {shownRooms.map((r) => {
                const n = countByRoom.get(r.code) ?? 0
                return (
                  <button
                    key={r.id}
                    onClick={() => void pickRoom(r)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-blue-50/60 transition-colors"
                  >
                    <span className="font-mono text-sm text-gray-800 w-44 truncate shrink-0">{r.code}</span>
                    <span className="text-sm text-gray-600 flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-gray-400 shrink-0 hidden sm:block">
                      {r.building} {r.floor}
                    </span>
                    <Badge
                      variant={n > 0 ? 'secondary' : 'outline'}
                      className={cn('shrink-0 font-normal tabular-nums', n === 0 && 'text-gray-400')}
                    >
                      {n} 台
                    </Badge>
                  </button>
                )
              })}
              {filteredRooms.length > MAX_ROOM_ROWS && (
                <p className="text-xs text-gray-400 p-2 text-center">
                  仅显示前 {MAX_ROOM_ROWS} 间，请用搜索或筛选缩小范围（共 {filteredRooms.length} 间）
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )

  const workbench = current && (
    <>
      <Card>
        <CardContent className="py-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-base font-medium text-gray-900 break-all">{current.code}</span>
                <Badge variant="secondary">{current.name}</Badge>
                {current.room_type && <Badge variant="outline">{current.room_type}</Badge>}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {current.building} {current.floor}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCurrent(null)} className="shrink-0">
              <ArrowLeft className="w-4 h-4 mr-1" />
              换房间
            </Button>
          </div>

          <div className="flex items-center gap-4 text-sm border-t border-gray-100 pt-3">
            <span className="text-gray-600">
              已绑定设备 <b className="text-blue-600 text-base tabular-nums">{count}</b> 台
            </span>
            <span className="text-gray-400 text-xs">本次已扫 {log.filter((l) => l.status !== 'missing').length} 次</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">扫码添加设备</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScanInput onScan={onScan} disabled={loadingRoom} />

          {conflict && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-sm text-red-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="break-all">{conflict.message}</span>
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void confirmMove()}>
                  改挂到本房间（{current.code}）
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>
                  忽略
                </Button>
              </div>
            </div>
          )}

          {log.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">本次扫码记录</p>
                <button onClick={() => setLog([])} className="text-xs text-gray-400 hover:text-gray-600">
                  清空
                </button>
              </div>
              <ul className="max-h-44 overflow-auto space-y-1">
                {log.map((l) => (
                  <li
                    key={l.key}
                    className={cn(
                      'flex items-center gap-2 rounded border px-2 py-1 text-xs',
                      LOG_STYLE[l.status],
                    )}
                  >
                    {l.status === 'ok' || l.status === 'moved' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span className="font-mono truncate">{l.code}</span>
                    {l.name && <span className="truncate flex-1">{l.name}</span>}
                    <span className="ml-auto shrink-0 whitespace-nowrap">
                      {LOG_LABEL[l.status]}
                      {l.detail ? ` · ${l.detail}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-600" />
            本房间已绑定设备（{count}）
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRoom && <Skeleton className="h-20 w-full" />}
          {!loadingRoom && devices.length === 0 && (
            <p className="text-sm text-gray-400">该房间暂无绑定设备，扫码即可添加。</p>
          )}
          {!loadingRoom && devices.length > 0 && (
            <div className="max-h-[46vh] overflow-auto divide-y divide-gray-100">
              {devices.map((d) => (
                <div key={d.device_code} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-gray-800 break-all">{d.device_code}</span>
                      {d.subsystem_name && (
                        <Badge variant="outline" className="font-normal">
                          {d.subsystem_name}
                        </Badge>
                      )}
                      {!d.is_registered && (
                        <Badge variant="outline" className="font-normal text-amber-700 border-amber-200 bg-amber-50">
                          仅台账
                        </Badge>
                      )}
                      {d.is_active === false && (
                        <Badge variant="outline" className="font-normal text-gray-400">
                          已注销
                        </Badge>
                      )}
                    </div>
                    {(d.name || d.location_desc) && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {[d.name, d.location_desc].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  {pendingRemove === d.device_code ? (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="destructive" onClick={() => void removeDevice(d.device_code)}>
                        确认移除
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingRemove(null)}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 text-gray-400 hover:text-red-600"
                      onClick={() => setPendingRemove(d.device_code)}
                      title="从本房间解绑"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Boxes className="w-5 h-5 text-blue-600" />
            扫码盘点
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            选房间 → 连续扫码 → 设备自动挂到该房间。一间房多台设备，一台设备只归属一间房。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadBase()} disabled={loadingBase} className="shrink-0">
          <RefreshCw className={cn('w-4 h-4 mr-1', loadingBase && 'animate-spin')} />
          刷新
        </Button>
      </div>

      {overview && (
        <Card>
          <CardContent className="py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-700">
              已关联设备的房间 <b className="tabular-nums">{overview.rooms_with_devices}</b> /{' '}
              <span className="tabular-nums">{overview.total_rooms}</span>
            </span>
            <span className="text-gray-700">
              已绑定设备 <b className="tabular-nums">{overview.total_bound_devices}</b> 台
            </span>
            <span className="text-xs text-gray-400">
              绑定后自动同步到「资产可视化」的机房区域树与区域统计
            </span>
          </CardContent>
        </Card>
      )}

      {current ? workbench : pickerPanel}
    </div>
  )
}
