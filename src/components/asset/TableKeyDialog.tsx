import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { KeyRound, Search, Loader2, AlertTriangle, Info } from 'lucide-react'
import { assetApi } from '@/services/assetApi'
import type { FieldDef } from '@/types/asset'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: number
  tableName?: string
  /** 保存成功后回调（用于刷新卡片上的「关联键：XXX」标签与覆盖率） */
  onSaved?: () => void
}

/**
 * 关键键编辑弹窗（数据表管理页直接入口）
 * ================================
 * 每张数据表两个「钥匙」概念，在此一处集中修改：
 *   - 关联键（单选）：该字段值写入 records.device_code，决定记录挂到哪个设备/房间。
 *     全表只能有一个；换成别的字段后，后端会**自动重算已有记录的 device_code**（空值保持原样）。
 *   - 跨表检索键（多选）：该字段取值可到其他资料表做关联检索（不改挂载、不影响统计）。
 *
 * 保存策略：只提交与初始值不同的字段（diff 提交），避免无谓写入。
 */
export default function TableKeyDialog({ open, onOpenChange, tableId, tableName, onSaved }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState<FieldDef[]>([])
  const [err, setErr] = useState<string | null>(null)

  // 编辑态：单选关联键 id（null = 无）；多选检索键 id 集合
  const [relId, setRelId] = useState<number | null>(null)
  const [searchIds, setSearchIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setErr(null)
    setFields([])
    assetApi
      .listFields(tableId)
      .then((fs) => {
        if (cancelled) return
        setFields(fs)
        const rel = fs.find((f) => f.is_relation_key)
        setRelId(rel ? rel.id : null)
        setSearchIds(new Set(fs.filter((f) => f.is_search_key).map((f) => f.id)))
      })
      .catch(() => {
        if (!cancelled) setErr('字段加载失败，请重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tableId])

  // 初始快照：用于 diff 出需要提交的字段
  const snapshot = useMemo(() => {
    const rel = fields.find((f) => f.is_relation_key)
    return {
      relId: rel ? rel.id : null,
      searchIds: new Set(fields.filter((f) => f.is_search_key).map((f) => f.id)),
    }
  }, [fields])

  const changed = useMemo(() => {
    const list: { fid: number; payload: { is_relation_key?: boolean; is_search_key?: boolean } }[] = []
    for (const f of fields) {
      const payload: { is_relation_key?: boolean; is_search_key?: boolean } = {}
      const origRel = snapshot.relId === f.id
      const origSearch = snapshot.searchIds.has(f.id)
      const curRel = relId === f.id
      const curSearch = searchIds.has(f.id)
      if (origRel !== curRel) payload.is_relation_key = curRel
      if (origSearch !== curSearch) payload.is_search_key = curSearch
      if (Object.keys(payload).length > 0) list.push({ fid: f.id, payload })
    }
    return list
  }, [fields, relId, searchIds, snapshot])

  const relChanged = snapshot.relId !== relId && relId !== null

  const handleSave = async () => {
    if (changed.length === 0) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      // 先提交「非关联键」的检索键改动，再提交关联键（关联键会触发后端重算 device_code）
      const ordered = [...changed].sort((a, b) => {
        const av = a.payload.is_relation_key === true ? 1 : 0
        const bv = b.payload.is_relation_key === true ? 1 : 0
        return av - bv
      })
      for (const c of ordered) {
        await assetApi.updateField(tableId, c.fid, c.payload)
      }
      onSaved?.()
      onOpenChange(false)
    } catch {
      setErr('保存失败：部分字段可能未生效，请重试')
    } finally {
      setSaving(false)
    }
  }

  const toggleSearch = (fid: number) => {
    setSearchIds((prev) => {
      const next = new Set(prev)
      if (next.has(fid)) next.delete(fid)
      else next.add(fid)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[82vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="w-4 h-4 text-blue-600" />
            关键键设置
            {tableName && <span className="text-xs font-normal text-gray-400">{tableName}</span>}
          </DialogTitle>
          <DialogDescription className="text-xs">
            关联键决定记录挂到哪个设备/房间（全表唯一，改后自动重算）；跨表检索键用于到其他资料表做关联检索（可多选）。
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-gray-400 py-8 text-center inline-flex items-center gap-2 w-full justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在加载字段…
          </p>
        )}

        {!loading && fields.length === 0 && (
          <p className="text-sm text-gray-400 py-8 text-center">该表还没有字段定义</p>
        )}

        {!loading && fields.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 px-2 pb-1 text-[11px] text-gray-400">
              <span className="w-5 shrink-0" />
              <span className="flex-1">字段</span>
              <span className="w-24 text-center">关联键</span>
              <span className="w-28 text-center">跨表检索键</span>
            </div>
            {fields.map((f) => (
              <div
                key={f.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                  relId === f.id ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200'
                }`}
              >
                <span className="w-5 shrink-0 text-center">
                  {relId === f.id ? (
                    <KeyRound className="w-3.5 h-3.5 text-blue-600 mx-auto" />
                  ) : searchIds.has(f.id) ? (
                    <Search className="w-3.5 h-3.5 text-teal-600 mx-auto" />
                  ) : null}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-gray-800 truncate">{f.label}</span>
                    <span className="text-[10px] text-gray-400 font-mono truncate">{f.key}</span>
                    {f.is_required && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        必填
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="w-24 shrink-0 flex justify-center">
                  <input
                    type="radio"
                    name={`rel-key-${tableId}`}
                    className="w-4 h-4 accent-blue-600 cursor-pointer"
                    checked={relId === f.id}
                    onChange={() => setRelId(relId === f.id ? null : f.id)}
                    title="设为关联键（全表唯一）"
                  />
                </div>
                <div className="w-28 shrink-0 flex justify-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-teal-600 cursor-pointer"
                    checked={searchIds.has(f.id)}
                    onChange={() => toggleSearch(f.id)}
                    title="设为跨表检索键（可多选）"
                  />
                </div>
              </div>
            ))}

            {relChanged && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  你更换了关联键：保存后该表**已有记录的 device_code 会按新字段值自动重算**
                  （新字段为空的记录保持原值不动）。这会影响这些记录挂到哪个设备/房间。
                </span>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-[11px] text-gray-500">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                「关联键」全表唯一——勾选新的会自动取消旧的；不勾任何字段即表示该表无关联键（记录不挂设备）。
              </span>
            </div>
          </div>
        )}

        {err && <p className="text-xs text-red-600 px-1">{err}</p>}

        <DialogFooter className="gap-2">
          <span className="text-[11px] text-gray-400 mr-auto">
            {changed.length > 0 ? `将提交 ${changed.length} 处改动` : '无改动'}
          </span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
