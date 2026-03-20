import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, ChevronLeft, ChevronRight, RefreshCw, Settings, Check } from 'lucide-react'
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
  morning?: ShiftData
  evening?: ShiftData
  high: number
  low: number
  total: number
  floors: string[]
  completed?: boolean  // 每天的完成状态
  rooms?: Room[]       // 懒加载的房间详情
  grouped?: { [floor: string]: Room[] }  // 按楼层分组
}

// 概要列表中的每一天
interface DaySummary {
  date: string
  day: number
  high: number
  low: number
  total: number
  floors: string[]
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
  // 概要列表（懒加载用）
  const [planList, setPlanList] = useState<DaySummary[]>([])
  const [planId, setPlanId] = useState<number | null>(null)
  // 详情缓存：{ "2026-03-01": DayPlan }
  const [dayDetails, setDayDetails] = useState<{ [date: string]: DayPlan }>({})
  const [rule, setRule] = useState<InspectionRule | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
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

  const [ruleForm, setRuleForm] = useState({ high_freq_days: 4, low_freq_times: 2 })

  // 加载计划概要列表（懒加载）
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // 并行加载规则和计划列表（概要）
      const [ruleData, listRes] = await Promise.all([
        api.getActiveInspectionRule().catch(() => null),
        api.getInspectionPlanList(year, month).catch(() => ({ days: [], plan_id: null }))
      ]) as [InspectionRule | null, { days: DaySummary[], plan_id: number | null }]

      if (ruleData) {
        setRule(ruleData)
        setRuleForm({ high_freq_days: ruleData.high_freq_days, low_freq_times: ruleData.low_freq_times })
      }

      setPlanList(listRes.days || [])
      setPlanId(listRes.plan_id || null)
      // 清空详情缓存
      setDayDetails({})
    } catch (err) {
      console.error('加载巡查计划失败', err)
      setPlanList([])
      setPlanId(null)
    } finally {
      setLoading(false)
    }
  }, [year, month])

  // 加载某天详情（点击日期时）
  const loadDayDetail = useCallback(async (date: string) => {
    if (!planId) return null
    
    // 如果缓存中有，直接返回
    if (dayDetails[date]) {
      return dayDetails[date]
    }
    
    setDetailLoading(true)
    try {
      const detail = await api.getInspectionPlanDayDetail(planId, date) as DayPlan
      // 缓存起来
      setDayDetails(prev => ({ ...prev, [date]: detail }))
      return detail
    } catch (err) {
      console.error('加载详情失败', err)
      return null
    } finally {
      setDetailLoading(false)
    }
  }, [planId, dayDetails])

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

  // ========== 统计（从概要计算）==========
  const totalInspections = planList.reduce((sum, d) => sum + (d.total || 0), 0)

  // ========== 日历格生成 ==========
  const firstDow = getFirstDayOfWeek(year, month)    // 0=周一
  const daysInMonth = getDaysInMonth(year, month)
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7
  const maxTotal = Math.max(...planList.map(d => d.total || 0), 1)

  // 获取选中的详情（从缓存或空）
  const selectedPlan = selectedDate ? dayDetails[selectedDate] || null : null

  // 点击日期加载详情
  const handleDateClick = async (dateStr: string) => {
    setSelectedDate(dateStr)
    await loadDayDetail(dateStr)
  }



  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ===== 页眉 ===== */}
      <div className="flex items-start justify-between flex-wrap gap-2 sm:gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">月度巡查计划</h1>
          <p className="text-gray-500 mt-0.5 sm:mt-1 text-xs sm:text-sm">
            {rule
              ? `高频每月 ${rule.high_freq_days} 次 · 低频每月 ${rule.low_freq_times} 次`
              : '暂无巡查规则，请先配置规则'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button variant="outline" size="sm" className="text-xs sm:text-sm px-2 sm:px-4" onClick={() => setShowRuleDialog(true)}>
            <Settings className="w-3 h-3 sm:w-4 sm:h-4 mr-1" /> <span className="hidden xs:inline">规则配置</span>
          </Button>
          <Button
            size="sm"
            onClick={() => handleGenerate(false)}
            disabled={generating || loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm px-2 sm:px-4"
          >
            {generating
              ? <><Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1 animate-spin" />生成中</>
              : <><RefreshCw className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />生成</>}
          </Button>
        </div>
      </div>

      {/* ===== 统计卡片 ===== */}
      {(planList.length > 0 || loading) && (
        <div className="flex gap-2 sm:gap-3 flex-wrap">
          {[
            { label: '巡查天数', value: planList.length, color: 'text-slate-800' },
            { label: '月总巡查次', value: totalInspections, color: 'text-indigo-600' },
          ].map(item => (
            <Card key={item.label} className="min-w-[80px] sm:min-w-[100px] flex-1">
              <CardContent className="pt-3 pb-2 sm:pt-4 sm:pb-3 text-center">
                <div className={cn('text-lg sm:text-2xl font-bold', item.color)}>{item.value}</div>
                <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">{item.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ===== 月份导航 ===== */}
      <div className="flex items-center justify-between px-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" onClick={prevMonth}><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" /></Button>
        <h2 className="text-base sm:text-xl font-bold text-slate-800">{year} 年 {month} 月</h2>
        <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" onClick={nextMonth}><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" /></Button>
      </div>

      {/* ===== 日历主体 ===== */}
      {loading ? (
        <Card><CardContent className="py-16 text-center">
          <Loader2 className="w-12 h-12 mx-auto text-blue-600 animate-spin mb-4" />
          <p className="text-gray-600">加载中...</p>
        </CardContent></Card>
      ) : (
        <div className="rounded-xl border overflow-hidden shadow-sm">
          {/* 星期行 - 响应式 */}
          <div className="grid grid-cols-7 bg-slate-800">
            {WEEKDAYS.map(w => (
              <div key={w} className="py-1.5 sm:py-2 text-[10px] sm:text-xs font-semibold text-slate-300">周{w}</div>
            ))}
          </div>
          {/* 日期格子 - 响应式高度 */}
          <div className="grid grid-cols-7 auto-rows-fr">
            {Array.from({ length: totalCells }).map((_, idx) => {
              const dayNum = idx - firstDow + 1
              const isValid = dayNum >= 1 && dayNum <= daysInMonth
              const dateStr = isValid ? `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}` : ''
              // 从概要列表中查找
              const plan = isValid ? planList.find(d => d.date === dateStr) : null
              const isToday = dateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
              const hPct = plan ? (plan.high / maxTotal) * 100 : 0
              const lPct = plan ? (plan.low / maxTotal) * 100 : 0

              return (
                <div
                  key={idx}
                  onClick={() => isValid && plan && handleDateClick(dateStr)}
                  className={cn(
                    'min-h-[60px] sm:min-h-[80px] md:min-h-[100px] p-1 sm:p-2 border-r border-b border-slate-100 transition-all flex flex-col',
                    isValid && plan ? 'cursor-pointer hover:bg-blue-50' : '',
                    isValid && !plan ? 'bg-gray-50 cursor-default' : '',
                    !isValid ? 'bg-slate-50 cursor-default' : '',
                    selectedDate === dateStr ? 'ring-2 ring-inset ring-blue-500' : ''
                  )}
                >
                  {isValid && (
                    <>
                      {/* 日期数字 + 完成状态 */}
                      <div className="flex items-center justify-between mb-0.5 sm:mb-1">
                        <div className={cn(
                          'text-xs sm:text-sm font-bold w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full',
                          isToday ? 'bg-blue-600 text-white' : 'text-slate-700'
                        )}>
                          {dayNum}
                        </div>
                      </div>

                      {plan ? (
                        <>
                          {/* 高低频进度条 */}
                          <div className="h-0.5 sm:h-1 bg-gray-200 rounded-full mb-0.5 sm:mb-1 flex overflow-hidden">
                            <div className="h-full bg-red-400" style={{ width: `${hPct}%` }} />
                            <div className="h-full bg-slate-400" style={{ width: `${lPct}%` }} />
                          </div>
                          {/* 徽章 - 响应式 */}
                          <div className="flex gap-0.5 flex-wrap mt-auto">
                            <Badge variant="outline" className="bg-slate-800 text-white text-[8px] sm:text-[9px] px-0.5 sm:px-1 py-0">
                              {plan.total}
                            </Badge>
                            {plan.high > 0 && (
                              <Badge variant="destructive" className="text-[8px] sm:text-[9px] px-0.5 sm:px-1 py-0">★{plan.high}</Badge>
                            )}
                            {plan.low > 0 && (
                              <Badge variant="secondary" className="text-[8px] sm:text-[9px] px-0.5 sm:px-1 py-0">☆{plan.low}</Badge>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="text-[8px] sm:text-[10px] text-gray-300 mt-auto hidden xs:block">无任务</div>
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
          <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto p-3 sm:p-6">
            <DialogHeader>
              <DialogTitle className="flex justify-between items-center bg-gradient-to-r from-blue-700 to-blue-500 text-white py-2 px-3 sm:py-3 sm:px-6 rounded-t-lg -mx-3 -mt-3 sm:-mx-6 sm:-mt-6 mb-3 sm:mb-4 text-sm sm:text-base">
                <span>
                  {year}年{month}月{selectedPlan.day}日 &nbsp;·&nbsp; 共 {selectedPlan.total} 间
                </span>
                <button onClick={() => setSelectedDate(null)} className="text-white/80 hover:text-white">
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </DialogTitle>
            </DialogHeader>

            {/* 加载中显示 */}
            {detailLoading ? (
              <div className="flex items-center justify-center py-8 sm:py-12">
                <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin text-blue-600" />
                <span className="ml-2 text-sm text-gray-500">加载中...</span>
              </div>
            ) : selectedPlan ? (
              <>
                {/* 汇总卡片 */}
                <div className="flex gap-2 sm:gap-3 mb-3 sm:mb-5">
                  {[
                    { label: '合计', value: selectedPlan.total, color: 'text-slate-800' },
                    { label: '★高频', value: selectedPlan.high, color: 'text-red-600' },
                    { label: '☆低频', value: selectedPlan.low, color: 'text-slate-600' },
                  ].map(item => (
                    <Card key={item.label} className="flex-1 min-w-[60px] sm:min-w-[70px]">
                      <CardContent className="pt-2 pb-1.5 sm:pt-3 sm:pb-2 text-center">
                        <div className={cn('text-base sm:text-xl font-bold', item.color)}>{item.value}</div>
                        <div className="text-[9px] sm:text-[10px] text-gray-500 mt-0.5 sm:mt-1">{item.label}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* 机房列表 - 不分早晚班 - 响应式 */}
                {selectedPlan.rooms && selectedPlan.rooms.length > 0 ? (
                  <div className="space-y-2 sm:space-y-3">
                    {Object.entries(selectedPlan.grouped || {}).map(([floor, rooms]) => (
                      <div key={floor}>
                        <div className="font-medium text-xs sm:text-sm text-gray-700 mb-1.5 sm:mb-2 flex items-center gap-1.5 sm:gap-2">
                          <span className="bg-slate-200 px-1.5 sm:px-2 py-0.5 rounded text-xs">{floor}</span>
                          <span className="text-[10px] sm:text-xs text-gray-400">({rooms.length}间)</span>
                        </div>
                        <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5 sm:gap-2">
                          {(rooms as Room[]).map((room, idx) => (
                            <div
                              key={idx}
                              onClick={() => selectedDate && toggleRoomComplete(selectedDate, room.机房编号)}
                              className={cn(
                                'p-1.5 sm:p-2 rounded border cursor-pointer transition-all',
                                selectedDate && isRoomCompleted(selectedDate, room.机房编号)
                                  ? 'bg-green-50 border-green-300'
                                  : 'bg-white border-gray-200 hover:border-blue-300'
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs sm:text-sm font-medium truncate">{room.机房名称}</span>
                                {selectedDate && isRoomCompleted(selectedDate, room.机房编号) && (
                                  <Check className="w-3 h-3 sm:w-4 sm:h-4 text-green-600 flex-shrink-0" />
                                )}
                              </div>
                              <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1 truncate">
                                {room.机房编号}
                              </div>
                              <div className={cn(
                                'text-[10px] sm:text-xs mt-0.5 sm:mt-1',
                                room.类型 === '高频' ? 'text-red-600' : 'text-gray-500'
                              )}>
                                {room.类型 === '高频' ? '★高频' : '☆低频'}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 sm:py-8 text-gray-400 text-sm">暂无巡查任务</div>
                )}
              </>
            ) : null}
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
