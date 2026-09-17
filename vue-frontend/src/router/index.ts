import { createRouter, createWebHistory } from 'vue-router'
import { APP_BASE } from '@/config'
import MainLayout from '@/layouts/MainLayout.vue'

// 13 条路由，与 React 版 src/App.tsx 完全等价（决策 D1：全量等价迁移，不删任何一条）
// 全量实现完成：一期（壳 + 资产总台账 + 检索）、二期（资产可视化 + 数据表管理 + 扫码盘点）、三期（6 页面）
const router = createRouter({
  history: createWebHistory(APP_BASE),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/phase3/OverviewView.vue'),
        },
        {
          path: 'cad',
          name: 'cad',
          component: () => import('@/views/phase3/CadView.vue'),
          meta: { title: 'CAD 图纸' },
        },
        {
          path: 'users',
          name: 'users',
          component: () => import('@/views/phase3/UsersView.vue'),
          meta: { title: '用户管理' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/phase3/SettingsView.vue'),
          meta: { title: '系统设置' },
        },
        {
          path: 'asset/search',
          name: 'asset-search',
          component: () => import('@/views/search/SearchView.vue'),
        },
        {
          path: 'asset/ledger',
          name: 'asset-ledger',
          component: () => import('@/views/ledger/LedgerView.vue'),
          meta: { title: '数据表管理' },
        },
        {
          path: 'asset/ledger/:tableId',
          name: 'asset-ledger-table',
          component: () => import('@/views/ledger/LedgerView.vue'),
          meta: { title: '数据表管理' },
        },
        {
          path: 'asset/devices',
          name: 'asset-devices',
          component: () => import('@/views/device/DeviceLedgerView.vue'),
        },
        {
          path: 'asset/settings',
          name: 'asset-settings',
          component: () => import('@/views/ledger/AssetSettingsView.vue'),
          meta: { title: '资料配置' },
        },
        {
          path: 'asset/qr-labels',
          name: 'asset-qr-labels',
          component: () => import('@/views/phase3/QrLabelView.vue'),
          meta: { title: '二维码标签' },
        },
        {
          path: 'asset/inventory',
          name: 'asset-inventory',
          component: () => import('@/views/scan/InventoryView.vue'),
          meta: { title: '扫码盘点' },
        },
        {
          path: 'asset-viz',
          name: 'asset-viz',
          component: () => import('@/views/viz/VizLayout.vue'),
          meta: { title: '资产可视化' },
        },
        {
          path: 'qr/:code',
          name: 'qr-scan',
          component: () => import('@/views/scan/ScanDeviceView.vue'),
          meta: { title: '扫码设备详情' },
        },
      ],
    },
    // 404 兜底：与 React 版一致，重定向到首页（不得白屏，AC-04）
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

export default router
