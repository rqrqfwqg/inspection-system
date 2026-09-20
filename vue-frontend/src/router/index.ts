import { createRouter, createWebHistory } from 'vue-router'
import { APP_BASE } from '@/config'
import MainLayout from '@/layouts/MainLayout.vue'

// 16 条路由，与 React 版 src/App.tsx 等价（决策 D1：全量等价迁移，不删任何一条）
// 全量实现完成：一期（壳 + 资产总台账 + 检索）、二期（资产可视化 + 数据表管理 + 扫码盘点）、三期（6 页面）
// + 工单执行流（一期 Phase 3 新增：3 条）
// 【路由顺序硬约束】/workorder/new 必须声明在 /workorder/:id **之前**，
//   否则会被动态段 :id 吃掉（/workorder/new → id='new'）。
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
        // ── 工单执行流（Phase 3）：静态段先于 /workorder/:id 声明 ──────────
        {
          path: 'workorder/list',
          name: 'workorder-list',
          component: () => import('@/views/workorder/WorkOrderListView.vue'),
          meta: { title: '工单' },
        },
        {
          path: 'workorder/new',
          name: 'workorder-new',
          component: () => import('@/views/workorder/WorkOrderCreateView.vue'),
          meta: { title: '新建工单', menuPath: '/workorder/list' },
        },
        // 动态段放最后：/workorder/:id
        {
          path: 'workorder/:id',
          name: 'workorder-detail',
          component: () => import('@/views/workorder/WorkOrderDetailView.vue'),
          // menuPath：详情页 / 新建页在侧栏统一高亮「工单」
          meta: { title: '工单详情', menuPath: '/workorder/list' },
        },
      ],
    },
    // 404 兜底：与 React 版一致，重定向到首页（不得白屏，AC-04）
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

export default router
