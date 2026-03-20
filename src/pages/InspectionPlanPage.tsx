import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, ChevronLeft, ChevronRight, RefreshCw, Settings, Check, Circle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { api } from '@/services/api'

// ==================== 类型定义 ====================

interface Room {
  楼栋: string
  楼层: string
  机房名称: string
  机房编号: string
  类型: '高频' | '低频'
  completed?: boolean  // 完成状态
}

interface ShiftData {
  rooms: Room[]
  grouped: { [floor: string]: Room[] }
}

interface DayPlan {
  date: string        // YYYY-MM-DD
  day: number
  morning: ShiftData
  evening: ShiftData
  high: number
  low: number
  total: number
  floors: string[]
  completed?: boolean  // 每天的完成状态
}

interface InspectionRule {
  id: number
  name: string
  high_freq_days: number
  low_freq_times: number
  is_active: boolean
}

// 存储完成状态的 key
const COMPLETED_KEY = 'inspection_completed_'

// ==================== 工具函数 ====================

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/** 获取某年月第一天是周几（0=周一 … 6=周日）*/
function getFirstDayOfWeek(year: number, month: number): number {
  const d = new Date(year, month - 1, 1).getDay() // 0=周日
  return d === 0 ? 6 : d - 1 // 转为周一=0
}

/** 获取某年月的天数 */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// ==================== 主组件 ====================

export default function InspectionPlanPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [planData, setPlanData] = useState<{ [date: string]: DayPlan }>({})
  const [rule, setRule] = useState<InspectionRule | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showRuleDialog, setShowRuleDialog] = useState(false)
  // 完成状态：{ "2026-03-01": { "roomCode": true, ... } }
  const [completedStatus, setCompletedStatus] = useState<{ [date: string]: { [roomCode: string]: boolean } }>({})

  // 加载完成状态
  useEffect(() => {
    const key = `${COMPLETED_KEY}${year}-${month}`
    const saved = localStorage.getItem(key)
    if (saved) {
      try {
        setCompletedStatus(JSON.parse(saved))
      } catch {}
    } else {
      setCompletedStatus({})
    }
  }, [year, month])

  // 保存完成状态
  const saveCompletedStatus = useCallback((status: { [date: string]: { [roomCode: string]: boolean } }) => {
    const key = `${COMPLETED_KEY}${year}-${month}`
    localStorage.setItem(key, JSON.stringify(status))
    setCompletedStatus(status)
  }, [year, month])

  // 切换机房完成状态
  const toggleRoomComplete = useCallback((date: string, roomCode: string) => {
    const newStatus = { ...completedStatus }
    if (!newStatus[date]) newStatus[date] = {}
    newStatus[date][roomCode] = !newStatus[date][roomCode]
    saveCompletedStatus(newStatus)
  }, [completedStatus, saveCompletedStatus])

  // 判断机房是否完成
  const isRoomCompleted = useCallback((date: string, roomCode: string) => {
    return completedStatus[date]?.[roomCode] ?? false
  }, [completedStatus])

  // 判断当天是否全部完成
  const isDayCompleted = useCallback((date: string, plan: DayPlan) => {
    if (!plan) return false
    const dayStatus = completedStatus[date] || {}
    const allRooms = [
      ...(plan.morning?.rooms || []),
      ...(plan.evening?.rooms || [])
    ]
    if (allRooms.length === 0) return false
    return allRooms.every(r => dayStatus[r.机房编号])
  }, [completedStatus])
  const [ruleForm, setRuleForm] = useState({ high_freq_days: 4, low_freq_times: 2 })

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // 加载规则
      try {
        const r = await api.getActiveInspectionRule() as InspectionRule
        setRule(r)
        setRuleForm({ high_freq_days: r.high_freq_days, low_freq_times: r.low_freq_times })
      } catch {
        // 暂无规则
      }

      // 加载当月计划
      const res = await api.getInspectionPlans({ limit: 100 }) as Array<{ year: number; month: number; id: number }>
      const matched = Array.isArray(res) ? res.find(p => p.year === year && p.month === month) : null

      if (matched) {
        // 使用新的按年月查询接口获取计划
        const planRes = await api.getInspectionPlanByYearMonth(year, month) as { year?: number; month?: number; data?: { [k: string]: DayPlan } }
        if (planRes?.year === year && planRes?.month === month && planRes?.data) {
          setPlanData(planRes.data)
        } else {
          // 如果查询失败，重新生成
          await api.generateInspectionPlan(year, month, true)
          const fresh = await api.getInspectionPlanByYearMonth(year, month) as { data?: { [k: string]: DayPlan } }
          setPlanData(fresh?.data ?? {})
        }
      } else {
        setPlanData({})
      }
    } catch (err) {
      console.error('加载巡查计划失败', err)
      setPlanData({})
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { loadData() }, [loadData])

  // 导航到上/下个月
  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  // 生成/重新生成当月计划
  const handleGenerate = async (overwrite = false) => {
    setGenerating(true)
    try {
      await api.generateInspectionPlan(year, month, overwrite)
      await loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('已存在') && !overwrite) {
        if (confirm(`${year}年${month}月计划已存在，是否覆盖重新生成？`)) {
          await handleGenerate(true)
        }
      } else {
        alert('生成失败：' + msg)
      }
    } finally {
      setGenerating(false)
    }
  }

  // 保存规则
  const handleSaveRule = async () => {
    try {
      if (rule) {
        await api.updateInspectionRule(rule.id, ruleForm)
      } else {
        await api.createInspectionRule({ name: '标准巡查规则', ...ruleForm, is_active: true })
      }
      const r = await api.getActiveInspectionRule() as InspectionRule
      setRule(r)

      // 保存规则后自动重新生成计划
      await handleGenerate(true)
      setShowRuleDialog(false)
    } catch (err: unknown) {
      alert('保存失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // ========== 统计 ==========
  const highRooms = new Set<string>()
  const lowRooms = new Set<string>()
  let totalInspections = 0
  Object.values(planData).forEach(day => {
    totalInspections += day.total || 0
    for (const shift of [day.morning, day.evening]) {
      if (!shift?.rooms) continue
      for (const room of shift.rooms) {
        if (room.类型 === '高频') highRooms.add(room.机房编号)
        else lowRooms.add(room.机房编号)
      }
    }
  })

  // ========== 日历格生成 ==========
  const firstDow = getFirstDayOfWeek(year, month)    // 0=周一
  const daysInMonth = getDaysInMonth(year, month)
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7
  const maxTotal = Math.max(...Object.values(planData).map(d => d.total || 0), 1)

  const selectedPlan = selectedDate ? planData[selectedDate] : null

  // ========== 渲染机房列表 ==========
  const getBuildingTag = (building: string) => {
    if (building === 'GTC') return <Badge className="bg-blue-600 hover:bg-blue-600 text-[10px] px-1">GTC</Badge>
    if (building === '东停车楼') return <Badge className="bg-green-600 hover:bg-green-600 text-[10px] px-1">东停</Badge>
    return <Badge className="bg-yellow-600 hover:bg-yellow-600 text-[10px] px-1">西停</Badge>
  }

  const renderShiftPanel = (shift: ShiftData, cls: string, label: string) => (
    <div className="border rounded-lg overflow-hidden">
      <div className={cn(
        'px-3 py-2 font-semibold text-sm flex justify-between items-center',
        cls === 'm' ? 'bg-orange-50 text-orange-800' : 'bg-blue-50 text-blue-800'
      )}>
        <span>{label}</span>
        <span>{shift?.rooms?.length ?? 0}间</span>
      </div>
      <div className="p-2 max-h-[50vh] overflow-y-auto">
        {shift?.rooms?.length ? Object.entries(shift.grouped ?? {}).map(([floor, rooms]) => (
          <div key={floor} className="mb-3 last:mb-0">
            <div className="text-xs font-semibold text-gray-700 px-2 py-1 bg-gray-100 rounded mb-1">{floor}</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-700 text-white">
                  <th className="px-2 py-1 text-center w-12">状态</th>
                  <th className="px-2 py-1 text-left">机房</th>
                  <th className="px-2 py-1 text-left">编号</th>
                  <th className="px-2 py-1 text-left">类型</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map(room => {
                  const completed = selectedDate ? isRoomCompleted(selectedDate, room.机房编号) : false
                  return (
                    <tr key={room.机房编号} className={cn(
                      "border-b border-slate-100",
                      completed ? "bg-green-50" : ""
                    )}>
                      <td className="px-1 py-1 text-center">
                        <button
                          onClick={() => selectedDate && toggleRoomComplete(selectedDate, room.机房编号)}
                          className={cn(
                            "p-1 rounded hover:bg-gray-200 transition-colors",
                            completed ? "text-green-600" : "text-gray-400"
                          )}
                          title={completed ? "点击标记为未完成" : "点击标记为已完成"}
                        >
                          {completed ? <Check className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                        </button>
                      </td>
                      <td className="px-2 py-1">{getBuildingTag(room.楼栋)} {room.机房名称}</td>
                      <td className="px-2 py-1 text-gray-500">{room.机房编号}</td>
                      <td className="px-2 py-1">
                        <Badge variant={room.类型 === '高频' ? 'destructive' : 'secondary'}>
                          {room.类型 === '高频' ? '★高频' : '☆低频'}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )) : (
          <p className="text-xs text-gray-400 text-center py-4">本班次无巡查任务</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* ===== 页眉 ===== */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">月度巡查计划</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {rule
              ? `高频每月 ${rule.high_freq_days} 次 · 低频每月 ${rule.low_freq_times} 次`
              : '暂无巡查规则，请先配置规则'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowRuleDialog(true)}>
            <Settings className="w-4 h-4 mr-1" /> 规则配置
          </Button>
          <Button
            size="sm"
            onClick={() => handleGenerate(false)}
            disabled={generating || loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {generating
              ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />生成中...</>
              : <><RefreshCw className="w-4 h-4 mr-1" />生成计划</>}
          </Button>
        </div>
      </div>

      {/* ===== 统计卡片 ===== */}
      {(Object.keys(planData).length > 0 || loading) && (
        <div className="flex gap-3 flex-wrap">
          {[
            { label: '巡查天数', value: daysInMonth, color: 'text-slate-800' },
            { label: '高频机房', value: highRooms.size, color: 'text-red-600' },
            { label: '低频机房', value: lowRooms.size, color: 'text-slate-600' },
            { label: '月总巡查次', value: totalInspections, color: 'text-indigo-600' },
          ].map(item => (
            <Card key={item.label} className="min-w-[100px] flex-1">
              <CardContent className="pt-4 pb-3 text-center">
                <div className={cn('text-2xl font-bold', item.color)}>{item.value}</div>
                <div className="text-xs text-gray-500 mt-1">{item.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ===== 月份导航 ===== */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="w-5 h-5" /></Button>
        <h2 className="text-xl font-bold text-slate-800">{year} 年 {month} 月</h2>
        <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="w-5 h-5" /></Button>
      </div>

      {/* ===== 日历主体 ===== */}
      {loading ? (
        <Card><CardContent className="py-16 text-center">
          <Loader2 className="w-12 h-12 mx-auto text-blue-600 animate-spin mb-4" />
          <p className="text-gray-600">加载中...</p>
        </CardContent></Card>
      ) : (
        <div className="rounded-xl border overflow-hidden shadow-sm">
          {/* 星期行 */}
          <div className="grid grid-cols-7 bg-slate-800">
            {WEEKDAYS.map(w => (
              <div key={w} className="py-2 text-center text-xs font-semibold text-slate-300">周{w}</div>
            ))}
          </div>
          {/* 日期格子 - 固定高度 grid，对齐 */}
          <div className="grid grid-cols-7 auto-rows-fr">
            {Array.from({ length: totalCells }).map((_, idx) => {
              const dayNum = idx - firstDow + 1
              const isValid = dayNum >= 1 && dayNum <= daysInMonth
              const dateStr = isValid ? `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}` : ''
              const plan = isValid ? planData[dateStr] : null
              const isToday = dateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
              const hPct = plan ? (plan.high / maxTotal) * 100 : 0
              const lPct = plan ? (plan.low / maxTotal) * 100 : 0
              const dayCompleted = plan ? isDayCompleted(dateStr, plan) : false

              return (
                <div
                  key={idx}
                  onClick={() => isValid && plan && setSelectedDate(dateStr)}
                  className={cn(
                    'min-h-[100px] p-2 border-r border-b border-slate-100 transition-all flex flex-col',
                    isValid && plan ? 'cursor-pointer hover:bg-blue-50' : '',
                    isValid && !plan ? 'bg-gray-50 cursor-default' : '',
                    !isValid ? 'bg-slate-50 cursor-default' : '',
                    selectedDate === dateStr ? 'ring-2 ring-inset ring-blue-500' : '',
                    dayCompleted && isValid ? 'bg-green-50' : ''
                  )}
                >
                  {isValid && (
                    <>
                      {/* 日期数字 + 完成状态 */}
                      <div className="flex items-center justify-between mb-1">
                        <div className={cn(
                          'text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full',
                          isToday ? 'bg-blue-600 text-white' : 'text-slate-700'
                        )}>
                          {dayNum}
                        </div>
                        {plan && dayCompleted && (
                          <Check className="w-4 h-4 text-green-600" />
                        )}
                      </div>

                      {plan ? (
                        <>
                          {/* 早晚班数量 */}
                          <div className="flex gap-0.5 mb-1 text-[9px]">
                            <span className="flex-1 bg-orange-50 text-orange-700 border border-orange-100 rounded px-0.5 text-center">
                              早{plan.morning?.rooms?.length ?? 0}
                            </span>
                            <span className="flex-1 bg-blue-50 text-blue-700 border border-blue-100 rounded px-0.5 text-center">
                              晚{plan.evening?.rooms?.length ?? 0}
                            </span>
                          </div>
                          {/* 高低频进度条 */}
                          <div className="h-1 bg-gray-200 rounded-full mb-1 flex overflow-hidden">
                            <div className="h-full bg-red-400" style={{ width: `${hPct}%` }} />
                            <div className="h-full bg-slate-400" style={{ width: `${lPct}%` }} />
                          </div>
                          {/* 徽章 */}
                          <div className="flex gap-0.5 flex-wrap mt-auto">
                            <Badge variant="outline" className="bg-slate-800 text-white text-[9px] px-1 py-0">
                              {plan.total}
                            </Badge>
                            {plan.high > 0 && (
                              <Badge variant="destructive" className="text-[9px] px-1 py-0">★{plan.high}</Badge>
                            )}
                            {plan.low > 0 && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0">☆{plan.low}</Badge>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] text-gray-300 mt-auto">无任务</div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== 详情弹窗 ===== */}
      <Dialog open={!!selectedDate} onOpenChange={open => !open && setSelectedDate(null)}>
        {selectedPlan && (
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex justify-between items-center bg-gradient-to-r from-blue-700 to-blue-500 text-white py-3 px-6 rounded-t-lg -mx-6 -mt-6 mb-4">
                <span>
                  {year}年{month}月{selectedPlan.day}日 &nbsp;·&nbsp; 共 {selectedPlan.total} 间机房
                </span>
                <button onClick={() => setSelectedDate(null)} className="text-white/80 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </DialogTitle>
            </DialogHeader>

            {/* 汇总卡片 */}
            <div className="flex gap-3 flex-wrap mb-5">
              {[
                { label: '合计', value: selectedPlan.total, color: 'text-slate-800' },
                { label: '★高频', value: selectedPlan.high, color: 'text-red-600' },
                { label: '☆低频', value: selectedPlan.low, color: 'text-slate-600' },
                { label: '早班', value: selectedPlan.morning?.rooms?.length ?? 0, color: 'text-amber-600' },
                { label: '晚班', value: selectedPlan.evening?.rooms?.length ?? 0, color: 'text-blue-600' },
              ].map(item => (
                <Card key={item.label} className="flex-1 min-w-[70px]">
                  <CardContent className="pt-3 pb-2 text-center">
                    <div className={cn('text-xl font-bold', item.color)}>{item.value}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{item.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 早晚班详情 */}
            <div className="grid md:grid-cols-2 gap-4">
              {renderShiftPanel(selectedPlan.morning, 'm', '🌅 早班')}
              {renderShiftPanel(selectedPlan.evening, 'e', '🌆 晚班')}
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* ===== 规则配置弹窗 ===== */}
      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>巡查规则配置</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                高频巡查周期（天）
              </label>
              <p className="text-xs text-gray-500 mb-2">每间高频机房每月巡查的次数，均摊分布到各天</p>
              <input
                type="number" min={1} max={30}
                value={ruleForm.high_freq_days}
                onChange={e => setRuleForm(f => ({ ...f, high_freq_days: Number(e.target.value) }))}
                className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                低频月巡次数（次/月）
              </label>
              <p className="text-xs text-gray-500 mb-2">每间低频机房每月巡查的次数，均摊分布到全月各天</p>
              <input
                type="number" min={1} max={10}
                value={ruleForm.low_freq_times}
                onChange={e => setRuleForm(f => ({ ...f, low_freq_times: Number(e.target.value) }))}
                className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowRuleDialog(false)}>取消</Button>
              <Button onClick={handleSaveRule}>保存规则</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
