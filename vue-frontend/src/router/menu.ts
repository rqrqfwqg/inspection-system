// 侧边栏菜单（10 项 = 既有 9 项 + 一期 Phase 3 工单模块 1 项）
// 显式导入 EP 图标（不走全局注册的名字解析，避免类型丢失与拼写静默失败）
import {
  User,
  Setting,
  Search,
  Grid,
  Box,
  DataAnalysis,
  Ticket,
  Aim,
  SetUp,
  Tickets,
} from '@element-plus/icons-vue'
import type { Component } from 'vue'

export interface MenuItem {
  /** 菜单标签（与 React 版一致，不得改写） */
  label: string
  /** 目标路由 */
  path: string
  /** Element Plus 图标组件（全项目唯一图标库） */
  icon: Component
  /** 是否管理员限定（生产 DISABLE_AUTH=true 下恒为 true） */
  adminOnly: boolean
}

export const MENU_ITEMS: MenuItem[] = [
  { label: '用户管理', path: '/users', icon: User, adminOnly: true },
  { label: '系统设置', path: '/settings', icon: Setting, adminOnly: false },
  { label: '资料检索', path: '/asset/search', icon: Search, adminOnly: false },
  { label: '数据表管理', path: '/asset/ledger', icon: Grid, adminOnly: false },
  { label: '设备台账', path: '/asset/devices', icon: Box, adminOnly: false },
  { label: '资产可视化', path: '/asset-viz', icon: DataAnalysis, adminOnly: false },
  { label: '二维码标签', path: '/asset/qr-labels', icon: Ticket, adminOnly: false },
  { label: '扫码盘点', path: '/asset/inventory', icon: Aim, adminOnly: false },
  { label: '工单', path: '/workorder/list', icon: Tickets, adminOnly: false },
  { label: '资料配置', path: '/asset/settings', icon: SetUp, adminOnly: true },
]
