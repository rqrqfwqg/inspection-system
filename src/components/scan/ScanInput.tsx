import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseScanPayload } from '@/features/scan/api'
import { cn } from '@/lib/utils'
import { Camera, CameraOff, Loader2, ScanLine } from 'lucide-react'

/** html5-qrcode 需要真实 DOM 元素作为挂载点，id 按实例唯一（避免同页多实例冲突） */
const CAMERA_REGION_PREFIX = 'scan-camera-region'

/** 只声明用到的接口，避免依赖 html5-qrcode 的类型定义（该库为动态引入） */
interface Html5QrcodeLike {
  start: (
    camera: unknown,
    config: unknown,
    onSuccess: (text: string) => void,
    onFailure?: () => void,
  ) => Promise<void>
  stop: () => Promise<void>
  clear: () => void
}

export interface ScanInputProps {
  /** 收到一个编号（已从二维码直达链接里解析出设备编号） */
  onScan: (code: string, raw: string) => void | Promise<void>
  disabled?: boolean
  placeholder?: string
  /** 是否提供摄像头扫码（默认提供；动态引入，不用则不加载） */
  enableCamera?: boolean
  className?: string
}

/**
 * 现场扫码输入（键盘 + 摄像头双通道）。
 *
 * - **扫码枪 / PDA**：这类设备本质是键盘，扫完自动补回车。输入框常驻聚焦，
 *   Enter 即提交并清空、重新聚焦，可连续作业。
 * - **手机摄像头**：点右侧相机按钮切换。html5-qrcode 走动态 import，
 *   不用摄像头的用户不会加载这部分代码。
 * - 内容解析走 `parseScanPayload`：标签二维码是 `/ops/qr/<编号>` 直达链接，
 *   扫码枪会输出整条 URL，此处自动提取编号，也兼容手输纯编号。
 */
export function ScanInput({
  onScan,
  disabled,
  placeholder,
  enableCamera = true,
  className,
}: ScanInputProps) {
  const [value, setValue] = React.useState('')
  const [cameraOn, setCameraOn] = React.useState(false)
  const [camError, setCamError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const inputRef = React.useRef<HTMLInputElement>(null)
  const busyRef = React.useRef(false)
  // 每个实例一个挂载点 id（useId 默认含冒号，去掉以免影响选择器）
  const regionId = `${CAMERA_REGION_PREFIX}-${React.useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  // 用 ref 持有回调，保证摄像头 effect 不因父级重渲染而反复重启
  const onScanRef = React.useRef(onScan)
  React.useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  const emit = React.useCallback(async (raw: string) => {
    const code = parseScanPayload(raw)
    if (!code || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await onScanRef.current(code, raw)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const commit = React.useCallback(async () => {
    const raw = value
    if (!raw.trim()) return
    setValue('')
    await emit(raw)
    if (!cameraOn) inputRef.current?.focus()
  }, [value, emit, cameraOn])

  // 摄像头生命周期：只在开关变化时启停
  React.useEffect(() => {
    if (!cameraOn || !enableCamera) return
    let cancelled = false
    let inst: Html5QrcodeLike | null = null
    /** 只有 start() 真正成功后才允许 stop() */
    let started = false

    /**
     * 安全停止。
     * ⚠️ html5-qrcode 的 stop() 在「扫描器未运行」时会**同步抛异常**（而非返回
     * rejected promise）。若不吞掉，异常会从 effect 清理函数冒出去，被 ErrorBoundary
     * 捕获导致整页崩溃 —— 而摄像头不可用（无权限/无设备）恰恰是最常见的情况。
     */
    const safeStop = () => {
      const s = inst
      if (!s || !started) return
      started = false
      try {
        const p = s.stop()
        if (p && typeof (p as Promise<void>).then === 'function') {
          ;(p as Promise<void>)
            .then(() => {
              try {
                s.clear()
              } catch {
                /* 容器可能已卸载 */
              }
            })
            .catch(() => undefined)
        }
      } catch {
        /* 未运行/已暂停：忽略 */
      }
    }

    void (async () => {
      setCamError('')
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled || !document.getElementById(regionId)) return
        const qr = new Html5Qrcode(regionId, {
          verbose: false,
        }) as unknown as Html5QrcodeLike
        inst = qr
        await qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          (text: string) => {
            void emit(text)
          },
          () => undefined,
        )
        started = true
        // 启动完成时若已关闭，立即收尾（此前 started=false，清理函数不会 stop）
        if (cancelled) safeStop()
      } catch (e) {
        if (!cancelled) {
          setCamError(e instanceof Error ? e.message : '摄像头启动失败')
          setCameraOn(false)
        }
      }
    })()

    return () => {
      cancelled = true
      safeStop()
    }
  }, [cameraOn, enableCamera, emit, regionId])

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commit()
              }
            }}
            disabled={disabled || busy}
            autoFocus={!cameraOn}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder ?? '扫码枪对准条码，扫完自动添加；或手输编号后回车'}
            className="pl-9 h-11 text-base font-mono"
          />
        </div>
        <Button
          onClick={() => void commit()}
          disabled={disabled || busy || !value.trim()}
          className="h-11 shrink-0"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : '添加'}
        </Button>
        {enableCamera && (
          <Button
            variant={cameraOn ? 'destructive' : 'outline'}
            className="h-11 shrink-0"
            onClick={() => setCameraOn((v) => !v)}
            disabled={disabled}
            title={cameraOn ? '关闭摄像头' : '用手机摄像头扫码'}
          >
            {cameraOn ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
          </Button>
        )}
      </div>

      {cameraOn && (
        <div className="space-y-1">
          <div
            id={regionId}
            className="w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 [&_video]:w-full [&_video]:rounded-lg"
          />
          <p className="text-xs text-gray-500">
            对准二维码，识别成功自动添加并继续扫描。
          </p>
        </div>
      )}
      {camError && (
        <p className="text-xs text-red-600">
          摄像头不可用：{camError}（需 HTTPS 访问并授权相机）
        </p>
      )}
      {!cameraOn && !disabled && (
        <p className="text-xs text-gray-400">
          识别到二维码直达链接时自动提取设备编号；重复扫同一台会提示「已在清单」。
        </p>
      )}
    </div>
  )
}
