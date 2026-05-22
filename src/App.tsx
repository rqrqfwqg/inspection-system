import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import UsersPage from '@/pages/UsersPage'
import SettingsPage from '@/pages/SettingsPage'
import ShiftHandoverPage from '@/pages/ShiftHandoverPage'
import DutyBoardPage from '@/pages/DutyBoardPage'
import InspectionPlanPage from '@/pages/InspectionPlanPage'
import CADPage from '@/pages/CADPage'
import MainLayout from '@/components/layout/MainLayout'

// 路由守卫：未登录跳转登录页
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      {/* 公开路由 */}
      <Route path="/login" element={<LoginPage />} />

      {/* 受保护路由 */}
      <Route path="/" element={
        <ProtectedRoute>
          <MainLayout />
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="duty-board" element={<DutyBoardPage />} />
        <Route path="inspection-plan" element={<InspectionPlanPage />} />
        <Route path="cad" element={<CADPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="shift-handover" element={<ShiftHandoverPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* 404 → 首页 */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <AppRoutes />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  )
}
