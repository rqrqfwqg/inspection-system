import { Link, useLocation } from 'react-router-dom'
import {
  Users,
  Settings,
  X,
  ClipboardList,
  CalendarClock,
  Calendar,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
}

export default function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const location = useLocation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const menuItems = [
    { icon: CalendarClock, label: '当班信息', path: '/duty-board', adminOnly: false },
    { icon: Calendar, label: '巡查计划', path: '/inspection-plan', adminOnly: false },
    { icon: ClipboardList, label: '交接班台账', path: '/shift-handover', adminOnly: false },
    // { icon: FileDigit, label: 'CAD处理', path: '/cad', adminOnly: false }, // 暂时隐藏CAD菜单
    { icon: Users, label: '用户管理', path: '/users', adminOnly: true },
    { icon: Settings, label: '系统设置', path: '/settings', adminOnly: false },
  ].filter(item => !item.adminOnly || isAdmin)

  return (
    <>
      {/* 移动端遮罩 */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* 侧边栏 */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-white border-r border-gray-200 transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:z-0 flex flex-col",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex-shrink-0 flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <span className="font-bold text-gray-900">值班管理系统</span>
          </div>
          <button
            onClick={onToggle}
            className="lg:hidden p-1 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 菜单 */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/' && location.pathname.startsWith(item.path))
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => window.innerWidth < 1024 && onToggle()}
                className={cn(
                  "flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200",
                  isActive
                    ? "bg-blue-50 text-blue-600 font-medium"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* 底部：当前用户角色提示 */}
        <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white">
          <div className="text-center text-xs text-gray-400">
            {isAdmin ? '管理员模式' : `${user?.department || '普通用户'}模式`}
          </div>
        </div>
      </aside>
    </>
  )
}
