import { useState, useEffect } from 'react'
import { Search, Plus, MoreHorizontal, Edit, Trash2, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import UserFormDialog from '@/components/users/UserFormDialog'
import { useToast } from '@/hooks/use-toast'
import { api } from '@/services/api'

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

const roleLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  admin: { label: '管理员', variant: 'default' },
  moderator: { label: '版主', variant: 'secondary' },
  user: { label: '用户', variant: 'outline' },
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  // 加载用户列表
  const loadUsers = async () => {
    try {
      setLoading(true)
      const data = await api.getUsers() as unknown as User[]
      setUsers(data)
    } catch (error) {
      toast({
        title: '加载失败',
        description: error instanceof Error ? error.message : '无法加载用户列表',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleAddUser = () => {
    setEditingUser(null)
    setIsDialogOpen(true)
  }

  const handleEditUser = (user: User) => {
    setEditingUser(user)
    setIsDialogOpen(true)
  }

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('确定要删除这个用户吗？')) return
    
    try {
      await api.deleteUser(userId)
      setUsers(users.filter((user) => user.id !== userId))
      toast({
        title: '删除成功',
        description: '用户已成功删除',
      })
    } catch (error) {
      toast({
        title: '删除失败',
        description: error instanceof Error ? error.message : '删除用户失败',
        variant: 'destructive',
      })
    }
  }

  const handleSaveUser = async (userData: Partial<User> & { password?: string }) => {
    try {
      if (editingUser) {
        // 编辑模式
        const updateData: { name?: string; department?: string; position?: string; phone?: string; avatar?: string } = {}
        if (userData.name) updateData.name = userData.name
        if (userData.department) updateData.department = userData.department
        if (userData.position) updateData.position = userData.position
        if (userData.phone) updateData.phone = userData.phone
        if (userData.avatar !== undefined) updateData.avatar = userData.avatar
        
        await api.updateUser(editingUser.id, updateData)
        
        // 重新加载用户列表
        await loadUsers()
        
        toast({
          title: '更新成功',
          description: '用户信息已更新',
        })
      } else {
        // 新增模式
        if (!userData.email) {
          toast({
            title: '错误',
            description: '请输入邮箱',
            variant: 'destructive',
          })
          return
        }
        
        if (!userData.name) {
          toast({
            title: '错误',
            description: '请输入姓名',
            variant: 'destructive',
          })
          return
        }
        
        if (!userData.password) {
          toast({
            title: '错误',
            description: '请输入密码',
            variant: 'destructive',
          })
          return
        }
        
        await api.createUser({
          email: userData.email,
          password: userData.password,
          name: userData.name,
          department: userData.department,
          position: userData.position,
          phone: userData.phone,
          avatar: userData.avatar,
        })
        
        // 重新加载用户列表
        await loadUsers()
        
        toast({
          title: '创建成功',
          description: '新用户已添加',
        })
      }
      setIsDialogOpen(false)
    } catch (error) {
      console.error('保存用户失败:', error)
      toast({
        title: '操作失败',
        description: error instanceof Error ? error.message : '保存用户失败',
        variant: 'destructive',
      })
    }
  }

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('zh-CN')
    } catch {
      return dateString
    }
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">用户管理</h1>
          <p className="text-gray-500 mt-1">管理系统中的所有用户</p>
        </div>
        <Button onClick={handleAddUser} className="w-full sm:w-auto">
          <Plus className="w-4 h-4 mr-2" />
          添加用户
        </Button>
      </div>

      {/* 用户列表卡片 */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="text-lg">用户列表</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="search"
                placeholder="搜索用户..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用户</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>部门</TableHead>
                    <TableHead>职位</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>注册时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                        暂无数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((user) => (
                      <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium flex-shrink-0">
                            {user.avatar ? (
                              <img
                                src={user.avatar.startsWith('http') ? user.avatar : user.avatar}
                                alt={user.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none'
                                  if (e.currentTarget.parentElement) {
                                    e.currentTarget.parentElement.textContent = user.name.charAt(0).toUpperCase()
                                  }
                                }}
                              />
                            ) : (
                              user.name.charAt(0).toUpperCase()
                            )}
                          </div>
                          <span className="font-medium text-gray-900">{user.name}</span>
                        </div>
                      </TableCell>
                        <TableCell className="text-gray-600">{user.email}</TableCell>
                        <TableCell className="text-gray-600">{user.department || '-'}</TableCell>
                        <TableCell className="text-gray-600">{user.position || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={roleLabels[user.role]?.variant || 'outline'}>
                            {roleLabels[user.role]?.label || user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.is_active ? 'default' : 'secondary'}>
                            {user.is_active ? '活跃' : '未激活'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-600">{formatDate(user.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>
                                <Eye className="w-4 h-4 mr-2" />
                                查看详情
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEditUser(user)}>
                                <Edit className="w-4 h-4 mr-2" />
                                编辑
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => handleDeleteUser(user.id)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* 分页信息 */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t">
            <p className="text-sm text-gray-500">
              显示 {filteredUsers.length} 条，共 {users.length} 条
            </p>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm" disabled>
                上一页
              </Button>
              <Button variant="outline" size="sm" disabled>
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 用户表单对话框 */}
      <UserFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        user={editingUser}
        onSave={handleSaveUser}
      />
    </div>
  )
}
