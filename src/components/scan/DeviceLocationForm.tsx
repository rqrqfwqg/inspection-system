import * as React from 'react'
import { MapPin, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { scanUpdateDevice } from '@/features/scan/api'
import type { ScanDevice, ScanRoom } from '@/features/scan/types'

interface Props {
  device: ScanDevice
  rooms: ScanRoom[]
  onSaved?: (updated: ScanDevice) => void
}

/**
 * 位置补录表单（扫码现场用）：
 * 楼栋 → 楼层 → 机房三级联动选择（数据源 rooms 516），选中机房自动带出楼栋/楼层；
 * 也可不选机房仅手填楼栋/楼层/位置描述。保存走 PUT /assets/devices/{id}（后端级联校验房间存在）。
 */
export function DeviceLocationForm({ device, rooms, onSaved }: Props) {
  const { toast } = useToast()
  const [saving, setSaving] = React.useState(false)
  const [building, setBuilding] = React.useState(device.building ?? '')
  const [floor, setFloor] = React.useState(device.floor ?? '')
  const [roomCode, setRoomCode] = React.useState('')
  const [locationDesc, setLocationDesc] = React.useState(device.location_desc ?? '')

  const active = React.useMemo(() => rooms.filter((r) => r.is_active !== false), [rooms])
  const buildings = React.useMemo(
    () => Array.from(new Set(active.map((r) => r.building).filter(Boolean))).sort(),
    [active],
  )
  const floors = React.useMemo(
    () => Array.from(new Set(active.filter((r) => r.building === building).map((r) => r.floor).filter(Boolean))).sort(),
    [active, building],
  )
  const roomOptions = React.useMemo(
    () => active.filter((r) => r.building === building && (!floor || r.floor === floor)),
    [active, building, floor],
  )

  const pickRoom = (code: string) => {
    setRoomCode(code)
    const room = active.find((r) => r.code === code)
    if (room) {
      setBuilding(room.building)
      setFloor(room.floor)
    }
  }

  const save = async () => {
    const room = roomCode ? active.find((r) => r.code === roomCode) : undefined
    setSaving(true)
    try {
      const updated = await scanUpdateDevice(device.id, {
        room_id: room ? room.id : null,
        building: room ? room.building : building,
        floor: room ? room.floor : floor,
        location_desc: locationDesc.trim(),
      })
      toast({ title: '位置已保存', description: updated.device_code })
      onSaved?.(updated)
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const canSave = building.trim() !== '' || floor.trim() !== '' || locationDesc.trim() !== '' || roomCode !== ''
  const roomLabel = (r: ScanRoom) => `${r.code}（${r.name}）`

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>楼栋</Label>
          <select
            value={building}
            onChange={(e) => { setBuilding(e.target.value); setRoomCode('') }}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">未指定</option>
            {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>楼层</Label>
          <select
            value={floor}
            onChange={(e) => { setFloor(e.target.value); setRoomCode('') }}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">未指定</option>
            {floors.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>机房（数据源 516 间 · 按楼栋/楼层过滤）</Label>
        <select
          value={roomCode}
          onChange={(e) => pickRoom(e.target.value)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">不选机房（可手动填楼栋楼层）</option>
          {roomOptions.map((r) => <option key={r.id} value={r.code}>{roomLabel(r)}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>位置描述（现场定位细节，如“3F-A 区走道尽头”）</Label>
        <Input value={locationDesc} onChange={(e) => setLocationDesc(e.target.value)} placeholder="柜号 / 参照物 / 图纸标注" />
      </div>

      <Button onClick={save} disabled={saving || !canSave} className="w-full">
        {saving ? <span className="animate-pulse">保存中</span> : (
          <>
            <Save className="w-4 h-4 mr-2" />
            保存位置
          </>
        )}
      </Button>
      <p className="text-xs text-gray-500 flex items-center gap-1">
        <MapPin className="w-3.5 h-3.5" />
        位置同时作为资产可视化区域树的挂靠依据
      </p>
    </div>
  )
}
