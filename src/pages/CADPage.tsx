import React, { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Upload, FileText, Layers, Box, Type, Download, Trash2 } from 'lucide-react'
import { api } from '@/services/api'
import { useToast } from '@/hooks/use-toast'
import { Toaster } from '@/components/ui/toaster'

interface CADFile {
  file_id: string
  filename: string
  size: number
  upload_time: number
}

interface CADAnalysis {
  filename: string
  version: string
  total_entities: number
  entity_types: Record<string, number>
  bounding_box: {
    width: number
    height: number
    min_x: number
    min_y: number
    max_x: number
    max_y: number
  }
  layers: Array<{
    name: string
    color: number
    entity_count: number
  }>
}

export default function CADPage() {
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)
  const [files, setFiles] = useState<CADFile[]>([])
  const [analysis, setAnalysis] = useState<CADAnalysis | null>(null)
  const [texts, setTexts] = useState<Array<{text: string; layer: string}>>([])

  // 上传文件
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.dxf')) {
      toast({ title: '错误', description: '仅支持 DXF 格式文件', variant: 'destructive' })
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/cad/upload', {
        method: 'POST',
        body: formData
      })

      const result = await response.json()
      if (result.success) {
        toast({ title: '成功', description: '文件上传成功' })
        fetchFiles()
        // 自动分析
        analyzeFile(result.file_id)
      } else {
        toast({ title: '错误', description: result.message || '上传失败', variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: '错误', description: '上传失败: ' + (error as Error).message, variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }, [])

  // 获取文件列表
  const fetchFiles = useCallback(async () => {
    try {
      const response = await api.get<{ files: CADFile[] }>('/cad/files')
      setFiles(response.files || [])
    } catch (error) {
      console.error('获取文件列表失败:', error)
    }
  }, [])

  // 分析文件
  const analyzeFile = useCallback(async (fileId: string) => {
    try {
      const [analysisRes, textRes] = await Promise.all([
        api.get<{ success: boolean; data?: CADAnalysis }>(`/cad/parse/${fileId}`),
        api.get<{ success: boolean; texts?: string[] }>(`/cad/text/${fileId}`)
      ])

      if (analysisRes.success && analysisRes.data) {
        setAnalysis(analysisRes.data)
      }
      if (textRes.success && textRes.texts) {
        setTexts(textRes.texts.map((t: string) => ({ text: t, layer: '' })))
      }
    } catch (error) {
      toast({ title: '错误', description: '分析失败: ' + (error as Error).message, variant: 'destructive' })
    }
  }, [])

  // 删除文件
  const deleteFile = useCallback(async (fileId: string) => {
    try {
      await api.delete(`/cad/files/${fileId}`)
      toast({ title: '成功', description: '文件已删除' })
      fetchFiles()
      setAnalysis(null)
      setTexts([])
    } catch (error) {
      toast({ title: '错误', description: '删除失败: ' + (error as Error).message, variant: 'destructive' })
    }
  }, [fetchFiles])

  // 导出 JSON
  const exportJSON = useCallback(async (fileId: string) => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:9527/api'
      const response = await fetch(`${API_BASE_URL}/cad/export/json/${fileId}?download=true`)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileId}.json`
      a.click()
      window.URL.revokeObjectURL(url)
      toast({ title: '成功', description: '导出成功' })
    } catch (error) {
      toast({ title: '错误', description: '导出失败: ' + (error as Error).message, variant: 'destructive' })
    }
  }, [])

  // 初始化加载
  React.useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  return (
    <>
      <Toaster />
      <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">CAD 文件处理</h1>
          <p className="text-slate-500 mt-1">上传、解析和提取 DXF 文件数据</p>
        </div>
      </div>

      {/* 上传区域 */}
      <Card>
        <CardContent className="p-6">
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors">
            <Upload className="w-12 h-12 mx-auto text-slate-400 mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-2">上传 CAD 文件</h3>
            <p className="text-slate-500 mb-4">支持 DXF 格式，文件大小不限</p>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".dxf"
                onChange={handleUpload}
                disabled={uploading}
                className="hidden"
              />
              <Button disabled={uploading} className="cursor-pointer">
                {uploading ? '上传中...' : '选择文件'}
              </Button>
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* 文件列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              已上传文件 ({files.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <p className="text-slate-500 text-center py-8">暂无文件</p>
            ) : (
              <div className="space-y-2">
                {files.map((file) => (
                  <div
                    key={file.file_id}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-700 truncate">
                        {file.filename}
                      </p>
                      <p className="text-sm text-slate-500">
                        {(file.size / 1024).toFixed(1)} KB · {new Date(file.upload_time * 1000).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => analyzeFile(file.file_id)}
                      >
                        分析
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => exportJSON(file.file_id)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteFile(file.file_id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 分析结果 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="w-5 h-5" />
              分析结果
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!analysis ? (
              <p className="text-slate-500 text-center py-8">上传文件后查看分析结果</p>
            ) : (
              <div className="space-y-4">
                {/* 基本信息 */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-sm text-slate-500">文件名</p>
                    <p className="font-medium text-slate-700 truncate">{analysis.filename}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-sm text-slate-500">DXF 版本</p>
                    <p className="font-medium text-slate-700">{analysis.version}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-sm text-slate-500">实体总数</p>
                    <p className="font-medium text-slate-700">{analysis.total_entities} 个</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <p className="text-sm text-slate-500">图纸尺寸</p>
                    <p className="font-medium text-slate-700">
                      {analysis.bounding_box.width.toFixed(1)} × {analysis.bounding_box.height.toFixed(1)}
                    </p>
                  </div>
                </div>

                {/* 实体类型 */}
                <div>
                  <h4 className="font-medium text-slate-700 mb-2">实体类型</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(analysis.entity_types).map(([type, count]) => (
                      <span
                        key={type}
                        className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
                      >
                        {type}: {count}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 图层信息 */}
                <div>
                  <h4 className="font-medium text-slate-700 mb-2 flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    图层信息
                  </h4>
                  <div className="space-y-1">
                    {analysis.layers.filter(l => l.entity_count > 0).map((layer) => (
                      <div
                        key={layer.name}
                        className="flex items-center justify-between p-2 bg-slate-50 rounded text-sm"
                      >
                        <span className="text-slate-700">{layer.name}</span>
                        <span className="text-slate-500">{layer.entity_count} 个实体</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 文字内容 */}
                {texts.length > 0 && (
                  <div>
                    <h4 className="font-medium text-slate-700 mb-2 flex items-center gap-2">
                      <Type className="w-4 h-4" />
                      文字内容 ({texts.length})
                    </h4>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {texts.map((text, idx) => (
                        <div
                          key={idx}
                          className="p-2 bg-slate-50 rounded text-sm"
                        >
                          <span className="text-slate-700">{text.text}</span>
                          <span className="text-slate-400 ml-2">({text.layer})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  )
}
