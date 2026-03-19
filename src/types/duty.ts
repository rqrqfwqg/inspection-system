// 排班班次类型
export type ShiftType = 'morning' | 'evening' | 'normal'

// 排班记录
export interface DutySchedule {
  id: string
  staffId: string
  staffName: string
  staffPhoto?: string
  department: string
  position: string
  shiftType: ShiftType
  date: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string // HH:mm
  status: 'scheduled' | 'on-duty' | 'off-duty' | 'leave'
  createdAt: string
  updatedAt: string
}

// 员工信息
export interface StaffMember {
  id: string
  name: string
  photo?: string
  department: string
  position: string
  phone?: string
  email?: string
}

// 班次定义
export interface ShiftDefinition {
  type: ShiftType
  name: string
  startTime: string
  endTime: string
  color: string
}

// 当班状态统计
export interface DutyStats {
  total: number
  onDuty: number
  offDuty: number
  onLeave: number
}

// 班次映射
export const SHIFT_DEFINITIONS: ShiftDefinition[] = [
  { type: 'morning', name: '早班', startTime: '09:00', endTime: '20:00', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  { type: 'evening', name: '晚班', startTime: '20:00', endTime: '09:00', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  { type: 'normal', name: '正常班', startTime: '09:00', endTime: '17:00', color: 'bg-blue-100 text-blue-800 border-blue-300' },
]

// 部门列表
export const DEPARTMENTS = [
  '南区',
  'T3GTC',
  '东区',
  '西区',
  '公共区',
  'AOC',
]
