import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import DashboardPage from '@/pages/DashboardPage'
import UsersPage from '@/pages/UsersPage'
import SettingsPage from '@/pages/SettingsPage'
import ShiftHandoverPage from '@/pages/ShiftHandoverPage'
import DutyBoardPage from '@/pages/DutyBoardPage'
import InspectionPlanPage from '@/pages/InspectionPlanPage'
import CADPage from '@/pages/CADPage'
import AssetSearchPage from '@/pages/asset/AssetSearchPage'
import AssetLedgerPage from '@/pages/asset/AssetLedgerPage'
import DeviceLedgerPage from '@/pages/asset/DeviceLedgerPage'
import AssetSettingsPage from '@/pages/asset/AssetSettingsPage'
import MainLayout from '@/components/layout/MainLayout'

function AppRoutes() {
  return (
    <Routes>
      {/* 运维系统整体挂到 /ops 命名空间（basename="/ops"）；取消登录，启动即进入系统 */}
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="duty-board" element={<DutyBoardPage />} />
        <Route path="inspection-plan" element={<InspectionPlanPage />} />
        <Route path="cad" element={<CADPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="shift-handover" element={<ShiftHandoverPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="asset/search" element={<AssetSearchPage />} />
        <Route path="asset/ledger" element={<AssetLedgerPage />} />
        <Route path="asset/devices" element={<DeviceLedgerPage />} />
        <Route path="asset/settings" element={<AssetSettingsPage />} />
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
