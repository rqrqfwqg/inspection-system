import * as React from 'react'
import { LayoutDashboard, Map, Boxes, Search, Upload, Share2, Network } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DashboardPage } from './DashboardPage'
import { AreaTreePage } from './AreaTreePage'
import { SubsystemTreePage } from './SubsystemTreePage'
import { DeviceHierarchyTreePage } from './DeviceHierarchyTreePage'
import { BaSystemTreePage } from './BaSystemTreePage'
import { SearchPage } from './SearchPage'
import { ImportCenterPage } from './ImportCenterPage'
import { DeviceDetailDrawer } from './DeviceDetailDrawer'

const TABS = [
  { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'area', label: '区域树', icon: Map },
  { key: 'subsystem', label: '子系统树', icon: Boxes },
  { key: 'device', label: '设备层级', icon: Share2 },
  { key: 'ba', label: 'BA系统', icon: Network },
  { key: 'search', label: '检索', icon: Search },
  { key: 'import', label: '导入', icon: Upload },
] as const

/**
 * T3GTC 资产可视化统一入口。
 * 顶部 Tabs 在 5 个视图间切换；设备详情抽屉挂在布局层，跨视图复用。
 * 子系统树选中某系统 → 切换至概览并按该系统过滤（跨视图联动）。
 */
export default function AssetsLayout() {
  const [activeTab, setActiveTab] = React.useState<string>('overview')
  const [drawerCode, setDrawerCode] = React.useState<string | null>(null)
  const [subsystemFilter, setSubsystemFilter] = React.useState<string | undefined>(undefined)

  const openDevice = React.useCallback((code: string) => {
    if (code) setDrawerCode(code)
  }, [])

  const selectSubsystem = React.useCallback((code: string) => {
    setSubsystemFilter(code)
    setActiveTab('overview')
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">T3GTC 资产可视化</h1>
        <p className="text-gray-500 mt-1 text-sm">
          基于资产数据（楼栋 / 房间 / 设备 / 子系统 / BA）的多维可视化与检索。
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <TabsTrigger key={t.key} value={t.key} className="flex items-center gap-1">
                <Icon className="w-4 h-4" />
                {t.label}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value="overview">
          <DashboardPage
            subsystemFilter={subsystemFilter}
            onClearFilter={() => setSubsystemFilter(undefined)}
          />
        </TabsContent>
        <TabsContent value="area">
          <AreaTreePage onOpenDevice={openDevice} />
        </TabsContent>
        <TabsContent value="subsystem">
          <SubsystemTreePage onOpenDevice={openDevice} onSelectSubsystem={selectSubsystem} />
        </TabsContent>
        <TabsContent value="device">
          <DeviceHierarchyTreePage onOpenDevice={openDevice} />
        </TabsContent>
        <TabsContent value="ba">
          <BaSystemTreePage onOpenDevice={openDevice} />
        </TabsContent>
        <TabsContent value="search">
          <SearchPage onOpenDevice={openDevice} />
        </TabsContent>
        <TabsContent value="import">
          <ImportCenterPage />
        </TabsContent>
      </Tabs>

      <DeviceDetailDrawer
        deviceCode={drawerCode}
        open={!!drawerCode}
        onOpenChange={(o) => {
          if (!o) setDrawerCode(null)
        }}
        onNavigate={(c) => setDrawerCode(c)}
      />
    </div>
  )
}
