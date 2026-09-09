import * as React from 'react'
import {
  Search as SearchIcon,
  FileSearch,
  Boxes,
  Wrench,
  Tag,
  Link2,
  AlertTriangle,
  FileText,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { searchDevice } from './api'
import type { SearchResult, RelationEdge } from './types'
import { FieldList, formatValue } from './FieldList'

interface SearchPageProps {
  /** 点击设备编号时打开详情抽屉 */
  onOpenDevice: (code: string) => void
}

export function SearchPage({ onOpenDevice }: SearchPageProps) {
  const { toast } = useToast()
  const [code, setCode] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<SearchResult | null>(null)

  const doSearch = async () => {
    const c = code.trim()
    if (!c) {
      toast({ title: '请输入设备编号', variant: 'destructive' })
      return
    }
    setLoading(true)
    try {
      const res = await searchDevice(c)
      setResult(res)
      if (!res.found)
        toast({
          title: '未找到该设备',
          description: '请确认设备编号 / 移交编号 / BA编号 / 别名是否正确。',
          variant: 'destructive',
        })
    } catch (e) {
      toast({
        title: '检索失败',
        description: e instanceof Error ? e.message : '',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const currentCode = result?.device?.device_code
    ? String(result.device.device_code)
    : code.trim()

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              placeholder="输入设备编号 / 移交编号 / BA编号 / 别名"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSearch()
              }}
            />
            <Button onClick={doSearch} disabled={loading}>
              <SearchIcon className="w-4 h-4 mr-1" />
              {loading ? '检索中…' : '检索'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!result && !loading && (
        <Card>
          <CardContent className="py-16 text-center text-gray-400">
            <FileSearch className="w-10 h-10 mx-auto mb-3 opacity-50" />
            输入设备编号后点击「检索」
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="py-16 text-center text-gray-400">检索中…</CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <Boxes className="w-4 h-4" />设备基础信息
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => onOpenDevice(currentCode)}>
                打开设备详情
              </Button>
            </CardHeader>
            <CardContent>
              <FieldList data={result.device ?? null} emptyText="未检索到设备基础信息" />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />固定资产
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FieldList data={result.fixed_asset ?? null} emptyText="无" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />设备档案
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FieldList data={result.archive ?? null} emptyText="无" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />BA 问题（{result.problems?.length ?? 0}）
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!result.problems || result.problems.length === 0 ? (
                <p className="text-sm text-gray-500">无</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {result.problems.map((p, i) => (
                    <li
                      key={i}
                      className="border-b border-dashed border-gray-100 py-1 flex flex-wrap gap-2 items-center"
                    >
                      <Badge variant="destructive">{formatValue(p.status ?? '未知')}</Badge>
                      <span className="text-gray-700">{formatValue(p.problem_type ?? '')}</span>
                      <span className="text-gray-400">
                        · {formatValue(p.location ?? p.group_area ?? '')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wrench className="w-4 h-4" />配件（{result.accessories?.length ?? 0}）
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!result.accessories || result.accessories.length === 0 ? (
                <p className="text-sm text-gray-500">无</p>
              ) : (
                <div className="space-y-2">
                  {result.accessories.map((a, i) => (
                    <div key={i} className="border-b border-dashed border-gray-100 py-1">
                      <FieldList data={a} emptyText="—" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="w-4 h-4" />别名（{result.aliases?.length ?? 0}）
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!result.aliases || result.aliases.length === 0 ? (
                <p className="text-sm text-gray-500">无</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {result.aliases.map((a, i) => {
                    const aliasVal = (a as Record<string, unknown>)?.alias
                    return (
                      <Badge key={i} variant="outline">
                        {formatValue(aliasVal ?? a)}
                      </Badge>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="w-4 h-4" />关联设备（{result.relations?.length ?? 0}）
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!result.relations || result.relations.length === 0 ? (
                <p className="text-sm text-gray-500">无</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {result.relations.map((e, i) => {
                    const edge = e as unknown as RelationEdge
                    const other =
                      edge.from_code === currentCode ? edge.to_code : edge.from_code
                    return (
                      <li
                        key={i}
                        className="border-b border-dashed border-gray-100 py-1 flex gap-2 items-center"
                      >
                        <Badge variant="outline">{formatValue(edge.relation_type ?? '关联')}</Badge>
                        <button
                          className="font-mono text-blue-700 hover:underline"
                          onClick={() => other && onOpenDevice(String(other))}
                        >
                          {String(other ?? '')}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
