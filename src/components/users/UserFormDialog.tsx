import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import AvatarUpload from './AvatarUpload'
import { DEPARTMENTS } from '@/types/duty'

interface User {
  id: number
  email: string
  name: string
  department?: string
  position?: string
  phone?: string
  avatar?: string
  role: string
  is_active: boolean
  created_at: string
}

interface UserFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User | null
  onSave: (userData: Partial<User> & { password?: string }) => void
}

export default function UserFormDialog({
  open,
  onOpenChange,
  user,
  onSave,
}: UserFormDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '123456890',
    department: '',
    position: '',
    phone: '',
    avatar: '',
  })

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name,
        email: user.email,
        password: '',
        department: user.department || '',
        position: user.position || '',
        phone: user.phone || '',
        avatar: user.avatar || '',
      })
    } else {
      setFormData({
        name: '',
        email: '',
        password: '123456890',
        department: '',
        position: '',
        phone: '',
        avatar: '',
      })
    }
  }, [user, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    console.log('表单提交:', { user: !!user, formData })
    
    if (user) {
      // 编辑模式：只传递有值的字段
      const updateData: Partial<User> = {
        name: formData.name,
        avatar: formData.avatar,
      }
      if (formData.department) updateData.department = formData.department
      if (formData.position) updateData.position = formData.position
      if (formData.phone) updateData.phone = formData.phone
      console.log('编辑模式，传递数据:', updateData)
      onSave(updateData)
    } else {
      // 新增模式：必须包含密码
      const dataToSave = {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        department: formData.department || undefined,
        position: formData.position || undefined,
        phone: formData.phone || undefined,
        avatar: formData.avatar || undefined,
      }
      console.log('新增模式，传递数据:', dataToSave)
      onSave(dataToSave)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {user ? '编辑用户' : '添加用户'}
          </DialogTitle>
          <DialogDescription>
            {user ? '修改用户信息' : '创建新的用户账号'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* 头像上传 */}
            <div className="space-y-2">
              <Label>头像</Label>
              <AvatarUpload
                value={formData.avatar}
                onChange={(url) => setFormData({ ...formData, avatar: url })}
                name={formData.name}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">姓名 *</Label>
              <Input
                id="name"
                placeholder="请输入姓名"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">邮箱 {!user && '*'}</Label>
              <Input
                id="email"
                type="email"
                placeholder="请输入邮箱"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required={!user}
                disabled={!!user}
              />
              {user && (
                <p className="text-xs text-gray-500">邮箱不可修改</p>
              )}
            </div>

            {!user && (
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="默认密码：123456890"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  minLength={6}
                />
                <p className="text-xs text-gray-500">不填则使用默认密码 123456890</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="department">部门</Label>
              <Select
                value={formData.department || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, department: v === '__none__' ? '' : v })}
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="position">职位</Label>
              <Input
                id="position"
                placeholder="请输入职位"
                value={formData.position}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">电话</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="请输入电话"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">
              {user ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
