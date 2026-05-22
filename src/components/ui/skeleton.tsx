import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-gray-200", className)}
      {...props}
    />
  )
}

/** 页面标题骨架 */
function PageTitleSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
    </div>
  )
}

/** 统计卡片骨架 */
function StatCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex gap-3 flex-wrap">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="min-w-[100px] flex-1 rounded-xl border p-4">
          <Skeleton className="h-8 w-16 mx-auto mb-2" />
          <Skeleton className="h-3 w-12 mx-auto" />
        </div>
      ))}
    </div>
  )
}

/** 表格骨架 */
function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border">
      <div className="border-b bg-gray-50 p-3">
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="p-3">
            <div className="flex gap-4">
              {Array.from({ length: cols }).map((_, colIdx) => (
                <Skeleton key={colIdx} className="h-4 flex-1" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 卡片列表骨架 */
function CardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border p-5 space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-12 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 日历骨架 - 月视图 */
function CalendarSkeleton() {
  return (
    <div className="rounded-xl border overflow-hidden">
      {/* 星期行 */}
      <div className="grid grid-cols-7 bg-slate-800">
        {['一', '二', '三', '四', '五', '六', '日'].map(w => (
          <div key={w} className="py-2 text-center text-xs font-semibold text-slate-300">周{w}</div>
        ))}
      </div>
      {/* 日期格子 */}
      <div className="grid grid-cols-7 auto-rows-fr">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="min-h-[80px] sm:min-h-[100px] p-2 border-r border-b border-slate-100">
            <Skeleton className="h-5 w-5 rounded-full mb-2" />
            <Skeleton className="h-1 w-full mb-1" />
            <div className="flex gap-1">
              <Skeleton className="h-4 w-6 rounded" />
              <Skeleton className="h-4 w-6 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 表单骨架 */
function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}

/** 全屏加载 */
function FullPageSpinner({ message = "加载中..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  )
}

export {
  Skeleton,
  PageTitleSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
  CardListSkeleton,
  CalendarSkeleton,
  FormSkeleton,
  FullPageSpinner,
}
