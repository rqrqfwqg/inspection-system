import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  scanRelationTypes,
  scanPowerChain,
  scanCreateRelation,
  scanDeleteRelation,
} from '@/features/scan/api'
import type { ScanDevice, ScanRelationType, PowerChainResult } from '@/features/scan/types'
import { ArrowDown, ArrowUp, Link2, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * P1 · 现场关联面板（移动端）：
 *  - 上游供电/冷源链展示（扫这台设备 → 它从哪取电/供冷，最大 5 跳）
 *  - 现场建边：输入对方编号（移交/标签号/别名均可）→ 选关系类型 → 提交
 *  - 方向语义：kind=power/cooling 的 forward 边，from=上游(供电方/冷源) → to=下游(受电方/用冷)
 */
const KIND_STYLE: Record<string, string> = {
  power: 'bg-orange-50 text-orange-700 border-orange-200',
  cooling: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  locate: 'bg-slate-100 text-slate-600 border-slate-200',
  network: 'bg-violet-50 text-violet-700 border-violet-200',
  control: 'bg-blue-50 text-blue-700 border-blue-200',
  pipe: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  accessory: 'bg-amber-50 text-amber-700 border-amber-200',
  other: 'bg-gray-50 text-gray-500 border-gray-200',
}
const KIND_LABEL: Record<string, string> = {
  power: '供配电', cooling: '冷源', locate: '位置', network: '网络',
  control: '控制', pipe: '管路', accessory: '配件', other: '其他',
}

export function DeviceRelationPanel({
  device,
  onChanged,
}: {
  device: ScanDevice
  /** 建边/删边成功后通知父级刷新（邻居/链随之更新） */
  onChanged?: () => void
}) {
  const { toast } = useToast()
  const [types, setTypes] = React.useState<ScanRelationType[]>([])
  const [chain, setChain] = React.useState<PowerChainResult | null>(null)
  const [chainSide, setChainSide] = React.useState<'up' | 'both'>('up')
  const [loadingChain, setLoadingChain] = React.useState(false)

  // 建边表单
  const [otherCode, setOtherCode] = React.useState('')
  const [rtype, setRtype] = React.useState('')
  const [dir, setDir] = React.useState<'up' | 'down'>('up') // 对方相对本设备的方位
  const [meta, setMeta] = React.useState('')               // 备注（回路/线径/端口/VLAN 等）
  const [submitting, setSubmitting] = React.useState(false)

  const loadChain = React.useCallback(async (side: 'up' | 'both') => {
    setLoadingChain(true)
    try {
      const c = await scanPowerChain(device.id!, side, 3)
      setChain(c)
    } catch {
      /* 保留旧链 */
    } finally {
      setLoadingChain(false)
    }
  }, [device.id])

  React.useEffect(() => {
    if (!device?.id) return
    void loadChain(chainSide)
  }, [device.id, chainSide, loadChain])

  React.useEffect(() => {
    if (!device?.id) return
    scanRelationTypes()
      .then((t) => {
        setTypes(t)
        if (!rtype && t.length) {
          // 默认第一个 power 类类型
          const firstPower = t.find((x) => x.kind === 'power') || t[0]
          setRtype(firstPower.code)
        }
      })
      .catch(() => undefined)
    // 只在设备切换时初始化，避免覆盖用户选择
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id])

  const isForward = React.useMemo(() => {
    const t = types.find((x) => x.code === rtype)
    return !!t && (t.kind === 'power' || t.kind === 'cooling') && t.direction === 'forward'
  }, [types, rtype])

  const submit = async () => {
    if (!otherCode.trim()) {
      toast({ title: '请输入对方设备编号', variant: 'destructive' })
      return
    }
    if (!rtype) {
      toast({ title: '请选择关系类型', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      const me = device.device_code
      // forward 边：from=上游 → to=下游。dir=up => 对方是上游（对方→本设备）
      const from_code = dir === 'up' ? otherCode.trim() : me
      const to_code = dir === 'up' ? me : otherCode.trim()
      await scanCreateRelation({
        from_code,
        to_code,
        relation_type: rtype,
        meta: meta.trim() ? { note: meta.trim() } : {},
      })
      toast({ title: '关联已建立' })
      setOtherCode('')
      setMeta('')
      void loadChain(chainSide)
      onChanged?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '建边失败'
      toast({ title: '建边失败', description: msg, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const delEdge = async (rid: number) => {
    try {
      await scanDeleteRelation(rid)
      toast({ title: '关联已删除' })
      void loadChain(chainSide)
      onChanged?.()
    } catch (e) {
      toast({ title: '删除失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    }
  }

  const chainEdges = chain?.edges ?? []
  const hasUpstream = chainEdges.some((e) => e.side === 'up')

  return (
    <div className="space-y-4">
      {/* ---------- 上游供电/冷源链 ---------- */}
      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-orange-500" />
            供电 / 冷源链（{chainSide === 'up' ? '向上回溯' : '双向'}）
          </p>
          <div className="flex gap-1">
            {(['up', 'both'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setChainSide(s)}
                className={cn(
                  'px-2 py-0.5 text-xs rounded border transition-colors',
                  chainSide === s
                    ? 'bg-orange-600 text-white border-orange-600'
                    : 'bg-white text-gray-500 border-gray-200',
                )}
              >
                {s === 'up' ? '上游' : '双向'}
              </button>
            ))}
          </div>
        </div>

        {loadingChain && <p className="text-xs text-gray-400 mt-2">正在遍历供配电链…</p>}
        {!loadingChain && chain && !hasUpstream && chainSide === 'up' && (
          <p className="text-xs text-gray-400 mt-2">
            未发现供电/冷源上游（可现场建边：输入上级配电柜/冷水机组编号并选「取电/供配电/冷源」）
          </p>
        )}
        {!loadingChain && chain && (
          <ul className="mt-2 space-y-1.5">
            {chain.nodes
              .filter((n) => n.depth > 0)
              .sort((a, b) => a.depth - b.depth)
              .map((n) => {
                const rel = chainEdges.find(
                  (e) => e.side === 'up' && e.to === n.device_code,
                ) || chainEdges.find((e) => e.side === 'down' && e.from === n.device_code)
                const t = types.find((x) => x.label === rel?.type)
                const isUp = rel?.side === 'up'
                return (
                  <li key={n.device_code} className="flex items-center gap-1.5 text-sm">
                    {isUp ? (
                      <ArrowUp className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                    )}
                    <span className="truncate text-gray-700">
                      {n.name ? `${n.name}（${n.device_code}）` : n.device_code}
                    </span>
                    {rel && (
                      <Badge variant="outline" className={cn('shrink-0 font-normal', KIND_STYLE[t?.kind ?? 'other'] ?? KIND_STYLE.other)}>
                        {rel.type}
                      </Badge>
                    )}
                    {rel?.rid != null && (
                      <button
                        onClick={() => delEdge(rel.rid!)}
                        className="text-gray-300 hover:text-red-500 text-xs shrink-0 px-0.5"
                        title="删除此关联"
                      >
                        ×
                      </button>
                    )}
                  </li>
                )
              })}
          </ul>
        )}
      </div>

      {/* ---------- 现场建边 ---------- */}
      <div className="border-t border-gray-100 pt-3">
        <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5 mb-2">
          <Link2 className="w-4 h-4 text-blue-600" />
          现场建边（扫完这台，输入关联设备编号）
        </p>
        <div className="space-y-2.5">
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">对方设备编号</Label>
            <Input
              value={otherCode}
              onChange={(e) => setOtherCode(e.target.value)}
              placeholder="输入上级配电柜 / 冷水机组 / 交换机编号（别名亦可）"
              className="h-9 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">关系类型</Label>
              <Select value={rtype} onValueChange={(v) => setRtype(v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.label}（{KIND_LABEL[t.kind] ?? ''}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isForward && (
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">对方方位</Label>
                <Select value={dir} onValueChange={(v) => setDir(v as 'up' | 'down')}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="up">对方是上游（供电方/冷源）</SelectItem>
                    <SelectItem value="down">对方是下游（受电方/用冷）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Input
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            placeholder="备注（可选）：回路/线径/端口/VLAN 等"
            className="h-9 text-sm"
          />
          <Button onClick={submit} disabled={submitting} className="w-full" size="sm">
            {submitting ? '提交中…' : '建立关联'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 边类型徽章样式（导出供父级复用） */
export function relationKindBadge(kind?: string): string {
  return KIND_STYLE[kind ?? 'other'] ?? KIND_STYLE.other
}
