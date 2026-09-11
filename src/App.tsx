import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import DashboardPage from '@/pages/DashboardPage'
import UsersPage from '@/pages/UsersPage'
import SettingsPage from '@/pages/SettingsPage'
import CADPage from '@/pages/CADPage'
import AssetSearchPage from '@/pages/asset/AssetSearchPage'
import AssetLedgerPage from '@/pages/asset/AssetLedgerPage'
import DeviceLedgerPage from '@/pages/asset/DeviceLedgerPage'
import AssetSettingsPage from '@/pages/asset/AssetSettingsPage'
import QrLabelPage from '@/pages/asset/QrLabelPage'
import ScanDevicePage from '@/pages/asset/ScanDevicePage'
import AssetsLayout from '@/features/assets/AssetsLayout'
import MainLayout from '@/components/layout/MainLayout'

function AppRoutes() {
  return (
    <Routes>
      {/* 运维系统整体挂到 /ops 命名空间（basename="/ops"）；取消登录，启动即进入系统 */}
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="cad" element={<CADPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="asset/search" element={<AssetSearchPage />} />
        <Route path="asset/ledger" element={<AssetLedgerPage />} />
        {/* 单表视图独立成路由：浏览器/手机后退回概览，刷新与分享可直达某张表 */}
        <Route path="asset/ledger/:tableId" element={<AssetLedgerPage />} />
        <Route path="asset/devices" element={<DeviceLedgerPage />} />
        <Route path="asset/settings" element={<AssetSettingsPage />} />
        <Route path="asset/qr-labels" element={<QrLabelPage />} />
        <Route path="qr/:code" element={<ScanDevicePage />} />
        <Route path="asset-viz" element={<AssetsLayout />} />
      </Route>

      {/* 404 → 首页 */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter basename="/ops">
      <AuthProvider>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  )
}
