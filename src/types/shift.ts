export interface ShiftTask {
  id: string
  title: string
  completed: boolean
  createdAt: string
  completedAt?: string
  shift: 'morning' | 'evening'
  images: string[]
  handoverCount?: number
  handoverTime?: string
  order: number
  tags?: string[]
}

export interface ShiftHandoverDB {
  id: string
  tasks: ShiftTask[]
}
