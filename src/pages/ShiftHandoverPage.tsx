import { useState, useEffect, useCallback } from 'react'
import { Calendar, Clock, Plus, Download, History, CheckCircle2, Circle, Trash2, ArrowRight, Upload, X, ImageIcon, Building2, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { Toaster } from '@/components/ui/toaster'
import { api } from '@/services/api'
import { useAuth } from '@/contexts/AuthContext'
import * as XLSX from 'xlsx'

const IMAGE_BASE = ''

// 所有部门列表
const DEPARTMENTS = ['南区', 'T3GTC', '东区', '西区', '公共区', 'AOC']

interface ShiftTask {
  id: number
  title: string
  content?: string
  shift: string
  date: string
  department?: string
  completed: boolean
  completed_at?: string
  completed_by?: string
  priority: string
  notes?: string
  handover_count: number
  images?: string   // JSON字符串
  created_at: string
}

// 解析图片JSON字符串
function parseImages(imagesJson?: string): string[] {
  if (!imagesJson) return []
  try { return JSON.parse(imagesJson) } catch { return [] }
}

// 班次标签辅助函数
function shiftLabel(shift: string): string {
  if (shift === 'morning') return '早班 (9:00~20:00)'
  if (shift === 'evening') return '晚班 (20:00~次日9:00)'
  if (shift === 'normal') return '正常班'
  return shift
}
function shiftShort(shift: string): string {
  if (shift === 'morning') return '早班'
  if (shift === 'evening') return '晚班'
  if (shift === 'normal') return '正常班'
  return shift
}

export default function ShiftHandoverPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // 管理员默认查看所有部门（用特殊值 '__ALL__'），普通用户只看本部门
  const defaultDept = isAdmin ? '__ALL__' : (user?.department || '')
  const [selectedDept, setSelectedDept] = useState<string>(defaultDept)

  const [tasks, setTasks] = useState<ShiftTask[]>([])
  const [currentDate] = useState(new Date().toLocaleDateString('zh-CN'))
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [selectedShift, setSelectedShift] = useState<'morning' | 'evening'>('morning')
  const [searchTerm, setSearchTerm] = useState('')
  const [isAddTaskOpen, setIsAddTaskOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [exportStartDate, setExportStartDate] = useState(new Date().toISOString().split('T')[0])
  const [exportEndDate, setExportEndDate] = useState(new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending'>('all')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [historyTasks, setHistoryTasks] = useState<ShiftTask[]>([])
  const [uploadingTaskId, setUploadingTaskId] = useState<number | null>(null)
  const { toast } = useToast()

  // 自动判断当前班次
  useEffect(() => {
    const hour = new Date().getHours()
    setSelectedShift(hour >= 9 && hour < 20 ? 'morning' : 'evening')
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    setExportStartDate(startOfMonth.toISOString().split('T')[0])
    setExportEndDate(now.toISOString().split('T')[0])
  }, [])

  // 用户信息加载后同步部门默认值
  useEffect(() => {
    if (user) {
      setSelectedDept(isAdmin ? '__ALL__' : (user.department || ''))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // 加载任务：管理员查看所有部门时不传 department 参数
  const loadTasks = useCallback(async () => {
    try {
      setIsLoading(true)
      const params: { date: string; shift: string; department?: string } = {
        date: selectedDate,
        shift: selectedShift,
      }
      if (selectedDept && selectedDept !== '__ALL__') {
        params.department = selectedDept
      }
      const data = await api.getShiftTasks(params) as ShiftTask[]
      setTasks(data)
    } catch (error) {
      console.error('加载任务失败:', error)
      toast({ title: '加载失败', description: '无法从服务器加载任务', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }, [selectedDate, selectedShift, selectedDept, toast])

  useEffect(() => { loadTasks() }, [loadTasks])

  // ── 自动交班逻辑 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const autoHandover = async () => {
      const now = new Date()
      const todayStr = now.toISOString().split('T')[0]
      const hour = now.getHours()
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]

      const candidates: Array<{
        taskDate: string
        taskShift: string
        nextShift: string
        nextDate: string
        shouldTrigger: boolean
      }> = [
        { taskDate: todayStr, taskShift: 'morning', nextShift: 'evening', nextDate: todayStr, shouldTrigger: hour >= 20 },
        { taskDate: yesterdayStr, taskShift: 'evening', nextShift: 'morning', nextDate: todayStr, shouldTrigger: hour >= 9 },
      ]

      for (const c of candidates) {
        if (!c.shouldTrigger) continue
        const key = `auto_handover_${c.taskDate}_${c.taskShift}`
        if (localStorage.getItem(key) === 'done') continue
        try {
          // 仅拉取本部门（或管理员查全部）未完成任务
          const params: { date: string; shift: string; department?: string } = {
            date: c.taskDate,
            shift: c.taskShift,
          }
          if (!isAdmin && user?.department) params.department = user.department
          const pending = (await api.getShiftTasks(params) as ShiftTask[]).filter(t => !t.completed)
          if (pending.length === 0) { localStorage.setItem(key, 'done'); continue }
          for (const task of pending) {
            await api.handoverShiftTask(task.id, c.nextShift, c.nextDate)
          }
          localStorage.setItem(key, 'done')
          toast({
            title: '自动交班完成',
            description: `${c.taskDate} ${shiftShort(c.taskShift)} 的 ${pending.length} 条未完成任务已自动交接至 ${c.nextDate} ${shiftShort(c.nextShift)}`,
          })
          if (selectedDate === c.taskDate && selectedShift === c.taskShift) loadTasks()
        } catch (err) {
          console.error('自动交班失败:', err)
        }
      }
    }
    autoHandover()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 筛选任务（按搜索词）
  const filteredTasks = tasks.filter(task => {
    if (!searchTerm) return true
    return task.title.toLowerCase().includes(searchTerm.toLowerCase())
  })

  // 管理员查看全部时，按部门分组
  const tasksByDept: Record<string, ShiftTask[]> = {}
  if (isAdmin && selectedDept === '__ALL__') {
    for (const dept of DEPARTMENTS) {
      tasksByDept[dept] = filteredTasks.filter(t => t.department === dept)
    }
    // 未分配部门的任务归入"其他"
    const assigned = new Set(filteredTasks.filter(t => t.department).map(t => t.department))
    const unassigned = filteredTasks.filter(t => !t.department)
    if (unassigned.length > 0) tasksByDept['未分配'] = unassigned
    // 删除空部门（无任务的部门不显示）
    for (const dept of Object.keys(tasksByDept)) {
      if (tasksByDept[dept].length === 0) delete tasksByDept[dept]
    }
    void assigned
  }

  // 加载历史任务
  const loadHistoryTasks = async () => {
    try {
      const params: { department?: string } = {}
      if (!isAdmin && user?.department) params.department = user.department
      else if (isAdmin && selectedDept !== '__ALL__') params.department = selectedDept
      const data = await api.getShiftTasks(params) as ShiftTask[]
      setHistoryTasks(data)
    } catch {
      toast({ title: '加载失败', description: '无法加载历史任务', variant: 'destructive' })
    }
  }

  // 添加任务
  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) {
      toast({ title: '错误', description: '请输入任务内容', variant: 'destructive' })
      return
    }
    try {
      const dept = selectedDept === '__ALL__' ? undefined : selectedDept
      await api.createShiftTask({
        title: newTaskTitle.trim(),
        shift: selectedShift,
        date: selectedDate,
        department: dept || user?.department || undefined,
        priority: 'normal',
      })
      setNewTaskTitle('')
      setIsAddTaskOpen(false)
      await loadTasks()
      toast({ title: '成功', description: '任务已添加' })
    } catch (error) {
      toast({ title: '添加失败', description: error instanceof Error ? error.message : '创建失败', variant: 'destructive' })
    }
  }

  // 切换完成状态
  const handleToggleComplete = async (task: ShiftTask) => {
    try {
      await api.updateShiftTask(task.id, { completed: !task.completed })
      await loadTasks()
    } catch (error) {
      toast({ title: '操作失败', description: error instanceof Error ? error.message : '更新失败', variant: 'destructive' })
    }
  }

  // 删除任务
  const handleDeleteTask = async (id: number) => {
    if (!confirm('确定要删除这个任务吗？')) return
    try {
      await api.deleteShiftTask(id)
      await loadTasks()
      toast({ title: '成功', description: '任务已删除' })
    } catch (error) {
      toast({ title: '删除失败', description: error instanceof Error ? error.message : '删除失败', variant: 'destructive' })
    }
  }

  // 交班：将任务迁移到下一班次，原任务删除
  const handleHandover = async (task: ShiftTask) => {
    if (task.shift === 'normal') {
      toast({ title: '提示', description: '正常班任务不支持交班操作', variant: 'destructive' })
      return
    }
    let nextShift: string
    let nextDate: string
    if (task.shift === 'morning') {
      nextShift = 'evening'; nextDate = task.date
    } else {
      nextShift = 'morning'
      const d = new Date(task.date); d.setDate(d.getDate() + 1)
      nextDate = d.toISOString().split('T')[0]
    }
    const label = shiftLabel(nextShift)
    if (!confirm(`确认将此任务交接至 ${nextDate} ${label}？\n原任务将被删除。`)) return
    try {
      await api.handoverShiftTask(task.id, nextShift, nextDate)
      await loadTasks()
      toast({ title: '交班成功', description: `任务已移至 ${nextDate} ${shiftShort(nextShift)}` })
    } catch (error) {
      toast({ title: '交班失败', description: error instanceof Error ? error.message : '交班失败', variant: 'destructive' })
    }
  }

  // 压缩图片
  const compressImage = (file: File, maxPx = 1200, quality = 0.75): Promise<File> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          const compressed = new File([blob!], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
          resolve(compressed)
        }, 'image/jpeg', quality)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  // 上传图片
  const handleImageUpload = async (taskId: number, files: FileList) => {
    setUploadingTaskId(taskId)
    try {
      for (let i = 0; i < files.length; i++) {
        const compressed = await compressImage(files[i])
        await api.uploadShiftImage(taskId, compressed)
      }
      await loadTasks()
      toast({ title: '上传成功', description: `${files.length} 张图片已保存` })
    } catch (error) {
      toast({ title: '上传失败', description: error instanceof Error ? error.message : '上传失败', variant: 'destructive' })
    } finally {
      setUploadingTaskId(null)
    }
  }

  // 删除图片
  const handleDeleteImage = async (taskId: number, imageUrl: string) => {
    try {
      const task = tasks.find(t => t.id === taskId)
      if (!task) return
      const images = parseImages(task.images).filter(u => u !== imageUrl)
      await api.updateShiftTask(taskId, { images: JSON.stringify(images) })
      await loadTasks()
    } catch (error) {
      toast({ title: '删除失败', description: error instanceof Error ? error.message : '删除失败', variant: 'destructive' })
    }
  }

  // 导出 Excel
  const handleExport = async () => {
    try {
      const params: { department?: string } = {}
      if (!isAdmin && user?.department) params.department = user.department
      else if (isAdmin && selectedDept !== '__ALL__') params.department = selectedDept
      const all = await api.getShiftTasks(params) as ShiftTask[]
      const filtered = all.filter(task => {
        const taskDate = new Date(task.date)
        const start = new Date(exportStartDate)
        const end = new Date(exportEndDate)
        end.setHours(23, 59, 59, 999)
        return taskDate >= start && taskDate <= end
      })
      const excelData = filtered.map(task => ({
        部门: task.department || '-',
        任务内容: task.title,
        班次: shiftShort(task.shift),
        日期: task.date,
        创建时间: new Date(task.created_at).toLocaleString('zh-CN'),
        完成状态: task.completed ? '已完成' : '未完成',
        完成时间: task.completed_at ? new Date(task.completed_at).toLocaleString('zh-CN') : '-',
        优先级: task.priority === 'high' ? '高' : task.priority === 'low' ? '低' : '普通',
        交接次数: task.handover_count,
        备注: task.notes || '',
      }))
      const worksheet = XLSX.utils.json_to_sheet(excelData)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, '交接班记录')
      XLSX.writeFile(workbook, `交接班记录_${exportStartDate}_${exportEndDate}.xlsx`)
      setIsExportOpen(false)
      toast({ title: '成功', description: 'Excel 导出成功' })
    } catch {
      toast({ title: '导出失败', variant: 'destructive' })
    }
  }

  // ── 任务卡片渲染（复用） ───────────────────────────────────────────────────
  const renderTaskCard = (task: ShiftTask, index: number) => {
    const images = parseImages(task.images)
    const isUploading = uploadingTaskId === task.id
    return (
      <div
        key={task.id}
        className={`p-4 border rounded-lg transition-all ${task.completed ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200 hover:border-blue-200'}`}
      >
        <div className="flex items-start gap-3">
          {/* 完成状态 */}
          <button onClick={() => handleToggleComplete(task)} className="mt-1 flex-shrink-0">
            {task.completed
              ? <CheckCircle2 className="w-5 h-5 text-green-600" />
              : <Circle className="w-5 h-5 text-gray-400" />}
          </button>

          {/* 任务内容 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={task.shift === 'morning' ? 'default' : task.shift === 'evening' ? 'secondary' : 'outline'}>
                {shiftShort(task.shift)}
              </Badge>
              {task.priority === 'high' && <Badge variant="destructive">紧急</Badge>}
              <span className="text-sm text-gray-400">#{index + 1}</span>
              {task.handover_count > 0 && (
                <Badge variant="outline" className="text-orange-600 border-orange-300">
                  已交接 {task.handover_count} 次
                </Badge>
              )}
            </div>

            <h3 className={`text-base font-medium ${task.completed ? 'line-through text-gray-500' : 'text-gray-900'}`}>
              {task.title}
            </h3>
            {task.content && <p className="text-sm text-gray-600 mt-1">{task.content}</p>}
            {task.notes && <p className="text-xs text-gray-400 mt-1 italic">{task.notes}</p>}

            <div className="text-xs text-gray-400 mt-1">
              创建：{new Date(task.created_at).toLocaleString('zh-CN')}
              {task.completed && task.completed_at &&
                <span className="ml-2 text-green-600">
                  完成：{new Date(task.completed_at).toLocaleString('zh-CN')}
                </span>
              }
            </div>

            {/* 图片展示区 */}
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {images.map((imgUrl, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={`${IMAGE_BASE}${imgUrl}`}
                      alt={`附图 ${idx + 1}`}
                      className="w-20 h-20 object-cover rounded-lg cursor-pointer border border-gray-200 hover:border-blue-400"
                      onClick={() => setSelectedImage(`${IMAGE_BASE}${imgUrl}`)}
                    />
                    <button
                      onClick={() => handleDeleteImage(task.id, imgUrl)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 上传图片按钮 */}
            <div className="mt-2">
              <label className={`cursor-pointer inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-md border transition-colors ${isUploading ? 'text-gray-400 border-gray-200 cursor-not-allowed' : 'text-blue-600 border-blue-200 hover:bg-blue-50'}`}>
                {isUploading
                  ? <><span className="animate-spin inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full"></span> 上传中...</>
                  : <><ImageIcon className="w-3.5 h-3.5" /><Upload className="w-3.5 h-3.5" /> 上传图片</>
                }
                <input
                  type="file" accept="image/*" multiple className="hidden"
                  disabled={isUploading}
                  onChange={(e) => e.target.files && handleImageUpload(task.id, e.target.files)}
                />
              </label>
              {images.length > 0 && (
                <span className="ml-2 text-xs text-gray-400">{images.length} 张附图</span>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {!task.completed && task.shift !== 'normal' && (
              <Button size="sm" variant="outline" onClick={() => handleHandover(task)}
                className="text-orange-600 border-orange-300 hover:bg-orange-50">
                <ArrowRight className="w-4 h-4 mr-1" />交班
              </Button>
            )}
            {!task.completed && (
              <Button size="sm" variant="outline" onClick={() => handleToggleComplete(task)}
                className="text-green-600 border-green-300 hover:bg-green-50">
                <CheckCircle2 className="w-4 h-4 mr-1" />完成
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => handleDeleteTask(task.id)}>
              <Trash2 className="w-4 h-4 text-red-500" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── 单个部门板块 ─────────────────────────────────────────────────────────
  const renderDeptSection = (dept: string, deptTasks: ShiftTask[]) => (
    <Card key={dept}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-500" />
          <span>{dept}</span>
          <Badge variant="outline" className="ml-1 text-xs">{deptTasks.length} 项</Badge>
          <span className="ml-2 text-xs font-normal text-gray-400">
            已完成 {deptTasks.filter(t => t.completed).length} / {deptTasks.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {deptTasks.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-gray-400 text-sm">该部门暂无任务</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deptTasks.map((task, idx) => renderTaskCard(task, idx))}
          </div>
        )}
      </CardContent>
    </Card>
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  // 当前显示的部门名称
  const deptLabel = selectedDept === '__ALL__' ? '全部部门' : (selectedDept || '我的部门')

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">交接班台账</h1>
          <p className="text-gray-500 mt-1">管理交接班任务，数据与图片均持久化存储</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 部门切换 - 仅管理员显示 */}
          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <span>{deptLabel}</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onClick={() => setSelectedDept('__ALL__')}>
                  全部部门
                </DropdownMenuItem>
                {DEPARTMENTS.map(dept => (
                  <DropdownMenuItem key={dept} onClick={() => setSelectedDept(dept)}>
                    {dept}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="w-4 h-4" />
            <span>{shiftShort(selectedShift)} {currentDate}</span>
          </div>
        </div>
      </div>

      {/* 当前部门提示（普通用户） */}
      {!isAdmin && user?.department && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          <Building2 className="w-4 h-4" />
          <span>当前显示：<strong>{user.department}</strong> 部门的交接班任务</span>
        </div>
      )}

      {/* 筛选器 */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>选择日期</Label>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>选择班次</Label>
              <Select value={selectedShift} onValueChange={(v) => setSelectedShift(v as 'morning' | 'evening')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="morning">早班（9:00~20:00）</SelectItem>
                  <SelectItem value="evening">晚班（20:00~次日9:00）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>搜索任务</Label>
              <Input placeholder="搜索..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>操作</Label>
              <Button onClick={() => setIsAddTaskOpen(true)} className="w-full">
                <Plus className="w-4 h-4 mr-1" />添加任务
              </Button>
            </div>
            <div className="space-y-2">
              <Label>更多</Label>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsExportOpen(true)}>
                  <Download className="w-4 h-4 mr-1" />导出
                </Button>
                <Button variant="outline" onClick={() => { loadHistoryTasks(); setIsHistoryOpen(true) }}>
                  <History className="w-4 h-4 mr-1" />历史
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 任务列表 */}
      {isAdmin && selectedDept === '__ALL__' ? (
        /* 管理员全部部门视图：按部门分板块 */
        Object.keys(tasksByDept).length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">该日期该班次暂无任务</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(tasksByDept).map(([dept, deptTasks]) =>
              renderDeptSection(dept, deptTasks)
            )}
          </div>
        )
      ) : (
        /* 单部门视图 */
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {isAdmin ? `${deptLabel} — ` : ''}任务列表 ({filteredTasks.length})
              <span className="ml-2 text-sm font-normal text-gray-500">
                已完成 {filteredTasks.filter(t => t.completed).length} / {filteredTasks.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredTasks.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">该日期该班次暂无任务</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTasks.map((task, index) => renderTaskCard(task, index))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 添加任务对话框 */}
      <Dialog open={isAddTaskOpen} onOpenChange={setIsAddTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加任务</DialogTitle>
            <DialogDescription>
              将创建 {selectedDate} {shiftShort(selectedShift)}
              {selectedDept && selectedDept !== '__ALL__' ? ` · ${selectedDept}` : user?.department ? ` · ${user.department}` : ''} 的新任务
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="taskTitle">任务内容</Label>
              <Input
                id="taskTitle" placeholder="请输入任务内容..."
                value={newTaskTitle} onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddTaskOpen(false)}>取消</Button>
            <Button onClick={handleAddTask}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导出 Excel 对话框 */}
      <Dialog open={isExportOpen} onOpenChange={setIsExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导出 Excel</DialogTitle>
            <DialogDescription>选择导出时间范围</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>开始日期</Label>
              <Input type="date" value={exportStartDate} onChange={(e) => setExportStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>结束日期</Label>
              <Input type="date" value={exportEndDate} onChange={(e) => setExportEndDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportOpen(false)}>取消</Button>
            <Button onClick={handleExport}>导出</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 历史记录对话框 */}
      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>历史任务</DialogTitle>
            <DialogDescription>查看历史交接班任务</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>开始日期</Label>
                <Input type="date" value={exportStartDate} onChange={(e) => setExportStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>结束日期</Label>
                <Input type="date" value={exportEndDate} onChange={(e) => setExportEndDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>状态</Label>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | 'completed' | 'pending')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="completed">已完成</SelectItem>
                    <SelectItem value="pending">未完成</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3">
              {(() => {
                const filtered = historyTasks.filter(task => {
                  const taskDate = new Date(task.date)       // 统一用 task.date 字段
                  const start = new Date(exportStartDate)
                  const end = new Date(exportEndDate)
                  end.setHours(23, 59, 59, 999)
                  const dateMatch = taskDate >= start && taskDate <= end
                  const statusMatch = statusFilter === 'all'
                    || (statusFilter === 'completed' && task.completed)
                    || (statusFilter === 'pending' && !task.completed)
                  return dateMatch && statusMatch
                }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

                if (filtered.length === 0) {
                  return <div className="text-center py-12"><p className="text-gray-500">该时间段内暂无任务</p></div>
                }

                return filtered.map((task, index) => {
                  const imgs = parseImages(task.images)
                  return (
                    <div key={task.id} className={`p-4 border rounded-lg ${task.completed ? 'bg-gray-50' : 'bg-white'}`}>
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {task.completed
                            ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                            : <Circle className="w-5 h-5 text-gray-400" />}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant={task.shift === 'morning' ? 'default' : task.shift === 'evening' ? 'secondary' : 'outline'}>
                              {shiftShort(task.shift)}
                            </Badge>
                            {task.department && (
                              <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs">
                                {task.department}
                              </Badge>
                            )}
                            <span className="text-xs text-gray-400">#{index + 1} · {task.date}</span>
                            {task.handover_count > 0 && (
                              <Badge variant="outline" className="text-orange-600 border-orange-300 text-xs">
                                交接 {task.handover_count} 次
                              </Badge>
                            )}
                          </div>
                          <h3 className={`font-medium ${task.completed ? 'line-through text-gray-500' : ''}`}>
                            {task.title}
                          </h3>
                          <div className="text-xs text-gray-400 mt-1 space-x-2">
                            <span>{task.date}</span>
                            {task.completed && task.completed_by && (
                              <span className="text-green-600">完成人：{task.completed_by}</span>
                            )}
                          </div>
                          {imgs.length > 0 && (
                            <div className="flex gap-1 mt-2">
                              {imgs.map((imgUrl, idx) => (
                                <img
                                  key={idx}
                                  src={`${IMAGE_BASE}${imgUrl}`}
                                  alt={`附图${idx + 1}`}
                                  className="w-12 h-12 object-cover rounded cursor-pointer border"
                                  onClick={() => setSelectedImage(`${IMAGE_BASE}${imgUrl}`)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 全屏图片预览 */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage} alt="预览"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 text-white rounded-full flex items-center justify-center transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}

      <Toaster />
    </div>
  )
}
