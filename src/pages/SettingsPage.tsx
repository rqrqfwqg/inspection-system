import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Toaster } from '@/components/ui/toaster'
import { api } from '@/services/api'
import { useAuth } from '@/contexts/AuthContext'
import { DEPARTMENTS } from '@/types/duty'

interface UserInfo {
  id: number
  email: string
  name: string
  department?: string
  position?: string
  phone?: string
  role: string
}

export default function SettingsPage() {
  const { toast } = useToast()
  const { user: currentUser, refreshUser } = useAuth()
  const isAdmin = currentUser?.role === 'admin'

  // 管理员可选择要编辑的用户，普通用户只编辑自己
  const [users, setUsers] = useState<UserInfo[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [department, setDepartment] = useState('')
  const [position, setPosition] = useState('')
  const [phone, setPhone] = useState('')
  const [isSavingInfo, setIsSavingInfo] = useState(false)

  // 密码表单
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isChangingPwd, setIsChangingPwd] = useState(false)

  // 初始化：管理员加载所有用户，普通用户直接用当前登录信息
  useEffect(() => {
    if (!currentUser) return
    if (isAdmin) {
      api.getUsers().then((data) => {
        const list = data as unknown as UserInfo[]
        setUsers(list)
        // 默认选中当前登录用户
        const me = list.find(u => u.id === currentUser.id) || list[0]
        if (me) fillForm(me)
      }).catch(() => {
        toast({ title: '加载失败', description: '无法加载用户列表', variant: 'destructive' })
      })
    } else {
      // 普通用户只看自己
      fillForm(currentUser as UserInfo)
      setSelectedUserId(currentUser.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id])

  const fillForm = (u: UserInfo) => {
    setSelectedUserId(u.id)
    setName(u.name || '')
    setDepartment(u.department || '')
    setPosition(u.position || '')
    setPhone(u.phone || '')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const handleSelectUser = (userId: number) => {
    const u = users.find(u => u.id === userId)
    if (u) fillForm(u)
  }

  // 保存账户信息
  const handleSaveInfo = async () => {
    if (!selectedUserId) return
    if (!name.trim()) {
      toast({ title: '错误', description: '姓名不能为空', variant: 'destructive' })
      return
    }
    try {
      setIsSavingInfo(true)
      await api.updateUser(selectedUserId, {
        name: name.trim(),
        department: department.trim() || undefined,
        position: position.trim() || undefined,
        phone: phone.trim() || undefined,
      })
      // 若修改的是当前登录用户，刷新 AuthContext
      if (selectedUserId === currentUser?.id) {
        await refreshUser()
      }
      if (isAdmin) {
        setUsers(prev => prev.map(u => u.id === selectedUserId
          ? { ...u, name: name.trim(), department: department.trim(), position: position.trim(), phone: phone.trim() }
          : u
        ))
      }
      toast({ title: '保存成功', description: '账户信息已更新' })
    } catch (error) {
      toast({ title: '保存失败', description: error instanceof Error ? error.message : '更新失败', variant: 'destructive' })
    } finally {
      setIsSavingInfo(false)
    }
  }

  // 修改密码
  const handleChangePassword = async () => {
    if (!selectedUserId) return
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: '错误', description: '请填写所有密码字段', variant: 'destructive' })
      return
    }
    if (newPassword !== confirmPassword) {
      toast({ title: '错误', description: '两次输入的新密码不一致', variant: 'destructive' })
      return
    }
    if (newPassword.length < 6) {
      toast({ title: '错误', description: '新密码长度至少6位', variant: 'destructive' })
      return
    }
    try {
      setIsChangingPwd(true)
      await api.changePassword(selectedUserId, currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast({ title: '密码已更新', description: '新密码已生效' })
    } catch (error) {
      toast({ title: '修改失败', description: error instanceof Error ? error.message : '密码修改失败', variant: 'destructive' })
    } finally {
      setIsChangingPwd(false)
    }
  }

  const selectedUser = isAdmin ? users.find(u => u.id === selectedUserId) : (currentUser as UserInfo | null)

  return (
    <div className="space-y-6 max-w-3xl">
      {/* 页面标题 */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">系统设置</h1>
        <p className="text-gray-500 mt-1">
          {isAdmin ? '管理员可编辑所有用户账户信息' : '管理您的个人账户信息和密码'}
        </p>
      </div>

      {/* 选择要编辑的用户（仅管理员） */}
      {isAdmin && users.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>选择用户</CardTitle>
            <CardDescription>选择要修改设置的用户账户</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => handleSelectUser(u.id)}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedUserId === u.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {u.name}
                  {u.role === 'admin' && <span className="ml-1 text-xs opacity-75">(管理员)</span>}
                  {u.department && <span className="ml-1 text-xs opacity-60">· {u.department}</span>}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 账户信息 */}
      <Card>
        <CardHeader>
          <CardTitle>账户信息</CardTitle>
          <CardDescription>
            {selectedUser
              ? `正在编辑：${selectedUser.name}（${selectedUser.email}）`
              : '更新账户信息'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">姓名 *</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="请输入姓名" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="department">部门</Label>
            {isAdmin ? (
              <Select
                value={department || '__none__'}
                onValueChange={(v) => setDepartment(v === '__none__' ? '' : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="请选择部门" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不指定</SelectItem>
                  {DEPARTMENTS.map(dept => (
                    <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={department} disabled className="bg-gray-50 text-gray-500" placeholder="由管理员设置" />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="position">职位</Label>
            <Input id="position" value={position} onChange={e => setPosition(e.target.value)} placeholder="请输入职位" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">手机号</Label>
            <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="请输入手机号" />
          </div>
          <Button onClick={handleSaveInfo} disabled={isSavingInfo || !selectedUserId}>
            {isSavingInfo ? '保存中...' : '保存更改'}
          </Button>
        </CardContent>
      </Card>

      {/* 安全设置 */}
      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
          <CardDescription>
            {selectedUser ? `修改 ${selectedUser.name} 的登录密码` : '修改登录密码'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">当前密码</Label>
            <Input
              id="current-password" type="password"
              value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
              placeholder="请输入当前密码"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">新密码</Label>
            <Input
              id="new-password" type="password"
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              placeholder="至少6位"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">确认新密码</Label>
            <Input
              id="confirm-password" type="password"
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
            />
          </div>
          <Button onClick={handleChangePassword} disabled={isChangingPwd || !selectedUserId}>
            {isChangingPwd ? '更新中...' : '更新密码'}
          </Button>
        </CardContent>
      </Card>

      <Toaster />
    </div>
  )
}
