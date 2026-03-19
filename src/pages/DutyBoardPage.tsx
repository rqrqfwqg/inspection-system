import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Calendar, Users, Clock, ChevronLeft, ChevronRight, User, Building2 } from 'lucide-react'
import { SHIFT_DEFINITIONS, ShiftType, DEPARTMENTS } from '@/types/duty'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'

interface DutySchedule {
  id: number
  staff_id: number
  staff_name: string
  department: string
  position: string
  shift_type: ShiftType
  date: string
  start_time: string
  end_time: string
  status: string
  created_at: string
}

// 格式化日期显示
function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekday = weekdays[date.getDay()]
  return `${year}年${month}月${day}日 ${weekday}`
}

// 员工卡片组件
function StaffCard({ schedule, shiftDef }: { schedule: DutySchedule; shiftDef: typeof SHIFT_DEFINITIONS[0] }) {
  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-200">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold border-2 border-gray-200">
              {schedule.staff_name.charAt(0)}
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-gray-900 truncate">{schedule.staff_name}</h3>
              <Badge variant="outline" className={cn('text-xs', shiftDef.color)}>
                {shiftDef.name}
              </Badge>
            </div>
            
            <div className="space-y-1 text-sm text-gray-500">
              <div className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                <span>{schedule.department}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                <span>{schedule.position}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>{schedule.start_time} - {schedule.end_time}</span>
              </div>
            </div>
          </div>
          
          <div className="flex-shrink-0">
            <Badge 
              variant={schedule.status === 'on-duty' ? 'default' : 'secondary'}
              className={cn(
                schedule.status === 'on-duty' && 'bg-green-500 hover:bg-green-600',
                schedule.status === 'scheduled' && 'bg-blue-500 hover:bg-blue-600',
                schedule.status === 'off-duty' && 'bg-gray-400',
                schedule.status === 'leave' && 'bg-orange-400'
              )}
            >
              {schedule.status === 'on-duty' && '在岗'}
              {schedule.status === 'scheduled' && '待岗'}
              {schedule.status === 'off-duty' && '离岗'}
              {schedule.status === 'leave' && '请假'}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DutyBoardPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [schedules, setSchedules] = useState<DutySchedule[]>([])
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all')
  const [selectedShift, setSelectedShift] = useState<ShiftType | 'all'>('all')
  const [isLoading, setIsLoading] = useState(true)

  // 加载排班数据
  useEffect(() => {
    const loadSchedules = async () => {
      setIsLoading(true)
      try {
        const dateStr = currentDate.toISOString().split('T')[0]
        const data = await api.getDutySchedules({ date: dateStr })
        setSchedules(data as DutySchedule[])
      } catch (error) {
        console.error('加载排班数据失败:', error)
        setSchedules([])
      } finally {
        setIsLoading(false)
      }
    }
    
    loadSchedules()
  }, [currentDate])

  // 日期切换
  const handleDateChange = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate)
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1))
    setCurrentDate(newDate)
  }

  // 获取今天的日期字符串
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const currentDateStr = useMemo(() => currentDate.toISOString().split('T')[0], [currentDate])

  // 过滤排班数据
  const filteredSchedules = useMemo(() => {
    return schedules.filter(schedule => {
      if (selectedDepartment !== 'all' && schedule.department !== selectedDepartment) return false
      if (selectedShift !== 'all' && schedule.shift_type !== selectedShift) return false
      return true
    })
  }, [schedules, selectedDepartment, selectedShift])

  // 按班次分组
  const schedulesByShift = useMemo(() => {
    const grouped: Record<string, DutySchedule[]> = {
      morning: [],
      evening: [],
      normal: [],
    }
    
    filteredSchedules.forEach(schedule => {
      if (grouped[schedule.shift_type]) {
        grouped[schedule.shift_type].push(schedule)
      }
    })
    
    return grouped
  }, [filteredSchedules])

  // 统计数据
  const stats = useMemo(() => ({
    total: schedules.length,
    onDuty: schedules.filter(s => s.status === 'on-duty').length,
    scheduled: schedules.filter(s => s.status === 'scheduled').length,
    onLeave: schedules.filter(s => s.status === 'leave').length,
  }), [schedules])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">部门当班信息</h1>
          <p className="text-gray-500 mt-1">查看当日值班人员安排</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
            <Calendar className="w-4 h-4 mr-2" />
            今天
          </Button>
        </div>
      </div>

      {/* 日期选择器 */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => handleDateChange('prev')}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-900">{formatDate(currentDate)}</h2>
              {currentDateStr === todayStr && (
                <Badge variant="secondary" className="mt-1 bg-blue-100 text-blue-700">今天</Badge>
              )}
            </div>
            
            <Button variant="ghost" size="icon" onClick={() => handleDateChange('next')}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 筛选器和统计 */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">筛选条件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">部门</label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={selectedDepartment === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedDepartment('all')}
                >
                  全部
                </Button>
                {DEPARTMENTS.map(dept => (
                  <Button
                    key={dept}
                    variant={selectedDepartment === dept ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedDepartment(dept)}
                  >
                    {dept}
                  </Button>
                ))}
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">班次</label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={selectedShift === 'all' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedShift('all')}
                >
                  全部
                </Button>
                {SHIFT_DEFINITIONS.map(shift => (
                  <Button
                    key={shift.type}
                    variant={selectedShift === shift.type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedShift(shift.type)}
                  >
                    {shift.name}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardContent className="py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
                <div className="text-sm text-gray-600 mt-1">总人数</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-3xl font-bold text-green-600">{stats.onDuty}</div>
                <div className="text-sm text-gray-600 mt-1">在岗</div>
              </div>
              <div className="text-center p-4 bg-yellow-50 rounded-lg">
                <div className="text-3xl font-bold text-yellow-600">{stats.scheduled}</div>
                <div className="text-sm text-gray-600 mt-1">待岗</div>
              </div>
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-3xl font-bold text-orange-600">{stats.onLeave}</div>
                <div className="text-sm text-gray-600 mt-1">请假</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 班次展示区域 */}
      {SHIFT_DEFINITIONS.map(shiftDef => {
        const shiftSchedules = schedulesByShift[shiftDef.type]
        if (selectedShift !== 'all' && selectedShift !== shiftDef.type) return null
        if (shiftSchedules.length === 0) return null

        return (
          <div key={shiftDef.type} className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={cn('px-3 py-1 text-sm font-medium', shiftDef.color)}>
                {shiftDef.name}
              </Badge>
              <span className="text-sm text-gray-500">{shiftDef.startTime} - {shiftDef.endTime}</span>
              <Badge variant="secondary" className="ml-auto">{shiftSchedules.length} 人</Badge>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shiftSchedules.map(schedule => (
                <StaffCard key={schedule.id} schedule={schedule} shiftDef={shiftDef} />
              ))}
            </div>
          </div>
        )
      })}

      {/* 空状态 */}
      {filteredSchedules.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p className="text-lg font-medium">暂无当班人员</p>
              <p className="text-sm mt-1">请导入排班数据或添加员工信息</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
