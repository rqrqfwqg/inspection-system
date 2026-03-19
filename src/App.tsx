import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import UsersPage from '@/pages/UsersPage'
import SettingsPage from '@/pages/SettingsPage'
import ShiftHandoverPage from '@/pages/ShiftHandoverPage'
import DutyBoardPage from '@/pages/DutyBoardPage'
import InspectionPlanPage from '@/pages/InspectionPlanPage'
import CADPage from '@/pages/CADPage'
import MainLayout from '@/components/layout/MainLayout'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Navigate to="/duty-board" replace />} />
        <Route path="duty-board" element={<DutyBoardPage />} />
        <Route path="inspection-plan" element={<InspectionPlanPage />} />
        <Route path="cad" element={<CADPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="shift-handover" element={<ShiftHandoverPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* 兼容旧登录链接 → 直接跳首页 */}
      <Route path="/login" element={<Navigate to="/duty-board" replace />} />
      {/* 404 → 首页 */}
      <Route path="*" element={<Navigate to="/duty-board" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
