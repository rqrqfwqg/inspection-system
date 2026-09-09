import * as React from 'react'
import { Upload, FileSpreadsheet, Database, AlertCircle, RefreshCw, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { getImportBatches } from './api'
import type { ImportBatch } from './types'

const SCRIPTS = [
  {
    name: 'import_fixed_assets.py',
    desc: '导入固定资产台账，解析设备编号、价值、使用部门等字段。',
    scale: 7237,
    icon: FileSpreadsheet,
  },
  {
    name: 'import_rooms.py',
    desc: '导入机房 / 房间档案，建立楼栋 - 楼层 - 房间层级。',
    scale: 516,
    icon: Database,
  },
  {
    name: 'import_ba.py',
    desc: '导入 BA 系统设备与问题，建立 BA 编号与子系统映射。',
    scale: 86,
    icon: AlertCircle,
  },
]

const STATUS_LABEL: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  done: { label: '完成', variant: 'success' },
  partial: { label: '部分', variant: 'warning' },
  failed: { label: '失败', variant: 'destructive' },
}

function fmt(ts?: string): string {
  if (!ts) return '—'
  // 后端返回 ISO 字符串，前端裁剪到秒
  return ts.replace('T', ' ').slice(0, 19)
}

export function ImportCenterPage() {
  const { toast } = useToast()
  const [batches, setBatches] = React.useState<ImportBatch[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    getImportBatches()
      .then((b) => {
        if (!cancelled) setBatches(b)
      })
      .catch((e) => {
        if (!cancelled)
          toast({
            title: '加载导入批次失败',
            description: e instanceof Error ? e.message : '',
            variant: 'destructive',
          })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  const handleReimport = () => {
    if (!confirm('重新导入将覆盖现有数据，且需在后端执行导入脚本。确认继续？')) return
    toast({
      title: '已提交重新导入请求',
      description: '实际执行由后端脚本完成（P1 不在前端触发 shell）。请在后端执行 import_*.py 脚本。',
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />导入中心
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <p>
            本系统数据由三个后端导入脚本初始化，前端 P1 提供说明与占位操作。已导入规模：固定资产{' '}
            <Badge variant="secondary">7237</Badge>、机房 <Badge variant="secondary">516</Badge>、
            BA 问题 <Badge variant="secondary">86</Badge>。
          </p>
          <Button variant="outline" onClick={handleReimport}>
            <RefreshCw className="w-4 h-4 mr-1" />重新导入（占位）
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SCRIPTS.map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.name}>
              <CardContent className="pt-6 space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-5 h-5 text-blue-600" />
                  <code className="text-sm font-mono text-gray-800 break-all">{s.name}</code>
                </div>
                <p className="text-sm text-gray-500">{s.desc}</p>
                <div className="text-xs text-gray-400">
                  已导入约 <span className="font-semibold text-gray-600">{s.scale}</span> 条
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">导入批次</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-400">加载中…</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-gray-400">
              暂无导入批次记录（后端未写入 import_batches 或表为空）。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-3 font-medium">批次名</th>
                    <th className="py-2 pr-3 font-medium">类型</th>
                    <th className="py-2 pr-3 font-medium text-right">文件数</th>
                    <th className="py-2 pr-3 font-medium text-right">行数</th>
                    <th className="py-2 pr-3 font-medium">状态</th>
                    <th className="py-2 pr-3 font-medium">开始时间</th>
                    <th className="py-2 font-medium">结束时间</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b, i) => {
                    const st = STATUS_LABEL[String(b.status ?? 'done')] ?? STATUS_LABEL.done
                    return (
                      <tr key={b.id ?? i} className="border-b border-dashed border-gray-100">
                        <td className="py-2 pr-3 font-medium text-gray-800">{String(b.batch_name ?? '—')}</td>
                        <td className="py-2 pr-3 text-gray-600">{String(b.source_type ?? '—')}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{b.file_count ?? 0}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{b.row_count ?? 0}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={st.variant}>{st.label}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {fmt(b.started_at as string | undefined)}
                          </span>
                        </td>
                        <td className="py-2 text-gray-500 whitespace-nowrap">{fmt(b.finished_at as string | undefined)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
