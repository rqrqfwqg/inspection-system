import { User, DashboardStats } from '@/types'

export const mockUsers: User[] = [
  {
    id: '1',
    name: '张三',
    email: 'zhangsan@example.com',
    role: 'admin',
    status: 'active',
    createdAt: '2024-01-15',
    lastLogin: '2024-03-12',
  },
  {
    id: '2',
    name: '李四',
    email: 'lisi@example.com',
    role: 'user',
    status: 'active',
    createdAt: '2024-02-20',
    lastLogin: '2024-03-11',
  },
  {
    id: '3',
    name: '王五',
    email: 'wangwu@example.com',
    role: 'moderator',
    status: 'pending',
    createdAt: '2024-03-01',
  },
  {
    id: '4',
    name: '赵六',
    email: 'zhaoliu@example.com',
    role: 'user',
    status: 'inactive',
    createdAt: '2024-01-28',
    lastLogin: '2024-02-15',
  },
  {
    id: '5',
    name: '孙七',
    email: 'sunqi@example.com',
    role: 'user',
    status: 'active',
    createdAt: '2024-03-05',
    lastLogin: '2024-03-12',
  },
  {
    id: '6',
    name: '周八',
    email: 'zhouba@example.com',
    role: 'moderator',
    status: 'active',
    createdAt: '2024-02-10',
    lastLogin: '2024-03-10',
  },
  {
    id: '7',
    name: '吴九',
    email: 'wujiu@example.com',
    role: 'user',
    status: 'pending',
    createdAt: '2024-03-08',
  },
  {
    id: '8',
    name: '郑十',
    email: 'zhengshi@example.com',
    role: 'user',
    status: 'active',
    createdAt: '2024-02-25',
    lastLogin: '2024-03-12',
  },
]

export const mockDashboardStats: DashboardStats = {
  totalUsers: 1250,
  activeUsers: 890,
  newUsersToday: 23,
  pendingUsers: 45,
}

export const mockChartData = [
  { month: '1月', users: 400, active: 240 },
  { month: '2月', users: 500, active: 320 },
  { month: '3月', users: 600, active: 450 },
  { month: '4月', users: 700, active: 530 },
  { month: '5月', users: 800, active: 610 },
  { month: '6月', users: 900, active: 720 },
]
