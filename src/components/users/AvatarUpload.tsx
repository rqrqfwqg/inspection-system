import React, { useRef, useState, useEffect } from 'react'
import { X, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface AvatarUploadProps {
  value?: string
  onChange: (url: string) => void
  name?: string
}

export default function AvatarUpload({ value, onChange, name }: AvatarUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(value || null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  // 同步外部 value 变化
  useEffect(() => {
    if (value) {
      setPreview(value)
    }
  }, [value])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 检查文件类型
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: '格式错误',
        description: '只支持 JPG, PNG, GIF, WEBP 格式的图片',
        variant: 'destructive',
      })
      return
    }

    // 检查文件大小 (最大 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: '文件过大',
        description: '图片大小不能超过 5MB',
        variant: 'destructive',
      })
      return
    }

    // 预览图片
    const reader = new FileReader()
    reader.onload = (e) => {
      setPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)

    // 上传图片
    try {
      setUploading(true)
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('token')
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const response = await fetch('/api/upload/avatar', {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || '上传失败')
      }

      const data = await response.json()
      onChange(data.avatar_url)
      toast({
        title: '上传成功',
        description: '头像已上传',
      })
    } catch (error) {
      toast({
        title: '上传失败',
        description: error instanceof Error ? error.message : '上传头像失败',
        variant: 'destructive',
      })
      setPreview(value || null)
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = () => {
    setPreview(null)
    onChange('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-4">
      {/* 头像预览 */}
      <div className="relative">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
          {preview ? (
            <img
              src={preview.startsWith('data:') ? preview : preview}
              alt="头像"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-white text-2xl font-medium">
              {name?.charAt(0) || '?'}
            </span>
          )}
        </div>
        
        {/* 删除按钮 */}
        {preview && (
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 上传按钮 */}
      <div className="flex flex-col gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
              上传中...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              上传头像
            </>
          )}
        </Button>
        <p className="text-xs text-gray-500">
          支持 JPG, PNG, GIF, WEBP
          <br />
          最大 5MB
        </p>
      </div>
    </div>
  )
}
