import type { Device } from '@/types/asset'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export default function DeviceInfoCard({ device }: { device: Device | null }) {
  if (!device) return null
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-gray-900 truncate">{device.name}</span>
              <Badge variant={device.is_active ? 'success' : 'secondary'}>
                {device.is_active ? '在用' : '已注销'}
              </Badge>
            </div>
            <p className="text-sm text-gray-500 mt-1">设备编号：{device.device_code}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-600">
              {device.subsystem_name && <span>系统：{device.subsystem_name}</span>}
              {device.building && <span>楼栋：{device.building}</span>}
              {device.floor && <span>楼层：{device.floor}</span>}
              {device.location_desc && <span>位置：{device.location_desc}</span>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
