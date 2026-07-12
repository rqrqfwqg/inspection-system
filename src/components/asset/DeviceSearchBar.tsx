import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Props {
  value: string
  onChange: (v: string) => void
  onSearch: () => void
  loading?: boolean
}

export default function DeviceSearchBar({ value, onChange, onSearch, loading }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="输入设备编号，如 L-3F-A-001 / CB-L-A01 / CH-01"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch()
            }}
            className="pl-10"
          />
        </div>
        <Button onClick={onSearch} disabled={loading}>
          {loading ? '检索中...' : '全局检索'}
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        设备编号即各系统台账中的设备 / 回路编号（如 GTC 电柜总表中的编号）。可直接粘贴导入的台账编号进行跨系统追溯。
      </p>
    </div>
  )
}
