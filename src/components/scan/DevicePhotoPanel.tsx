import * as React from 'react'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { scanListPhotos, scanUploadPhoto, scanDeletePhoto } from '@/features/scan/api'
import type { DevicePhotoItem } from '@/features/scan/types'

interface Props {
  deviceId: number
}

/** 现场照片面板：调用系统相机/相册上传，多图展示，可删除（P0）。 */
export function DevicePhotoPanel({ deviceId }: Props) {
  const { toast } = useToast()
  const [photos, setPhotos] = React.useState<DevicePhotoItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [uploading, setUploading] = React.useState(false)
  const [note, setNote] = React.useState('')
  const fileRef = React.useRef<HTMLInputElement>(null)

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      setPhotos(await scanListPhotos(deviceId))
    } catch (e) {
      toast({ title: '照片加载失败', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [deviceId, toast])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      await scanUploadPhoto(deviceId, file, note.trim())
      setNote('')
      toast({ title: '照片已上传' })
      await reload()
    } catch (err) {
      toast({ title: '上传失败', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  const remove = async (p: DevicePhotoItem) => {
    if (!window.confirm('删除这张现场照片？')) return
    try {
      await scanDeletePhoto(p.id)
      toast({ title: '已删除' })
      await reload()
    } catch (err) {
      toast({ title: '删除失败', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="拍摄说明（可选，如：柜内铭牌 / 背面接线）" />
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
        <Button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="shrink-0"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          <span className="ml-2">拍摄/上传</span>
        </Button>
      </div>

      {loading && <p className="text-sm text-gray-400 animate-pulse">加载照片中</p>}

      {!loading && photos.length === 0 && (
        <p className="text-sm text-gray-400">暂无现场照片，拍一张铭牌或安装位置。</p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative group rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <img src={p.url} alt={p.note || '现场照片'} className="w-full h-24 object-cover" />
            {p.note && <p className="px-1.5 py-0.5 text-[11px] text-gray-600 truncate">{p.note}</p>}
            <button
              type="button"
              onClick={() => remove(p)}
              className="absolute top-1 right-1 p-1 rounded bg-black/55 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="删除照片"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
