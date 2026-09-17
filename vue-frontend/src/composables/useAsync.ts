/**
 * 异步三态封装（loading / error / data）
 * =====================================================================
 * 为什么必须统一：每个页面各写一份 loading/error 处理是「沉默逻辑错误」的高发区
 * （加载中不显示、失败静默、并发请求回来顺序错乱覆盖新数据）。此处只解决三件事：
 *   1. 并发竞态 —— 用自增序号丢弃过期响应（后发请求先回不得覆盖）；
 *   2. 错误一律转成可读文案（依赖 `@/api/http` 的 formatApiError）；
 *   3. 卸载后不再写状态（避免对已销毁组件的无谓更新）。
 *
 * 用法：
 *   const { data, loading, error, run } = useAsync(() => getLinkOverview())
 *   onMounted(run)
 */
import { ref, shallowRef, type Ref } from 'vue'

export interface UseAsyncResult<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string>
  /** 执行一次；返回本次结果（失败返回 null，不抛出——错误已进 error ref） */
  run: () => Promise<T | null>
  /** 手动清空（切筛选、重置时用） */
  reset: () => void
}

export function useAsync<T>(fn: () => Promise<T>): UseAsyncResult<T> {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref('')
  let seq = 0

  async function run(): Promise<T | null> {
    const mine = ++seq
    loading.value = true
    error.value = ''
    try {
      const r = await fn()
      if (mine !== seq) return null // 已有更新的请求发出，丢弃本次
      data.value = r
      return r
    } catch (e) {
      if (mine !== seq) return null
      error.value = e instanceof Error ? e.message : '请求失败'
      return null
    } finally {
      if (mine === seq) loading.value = false
    }
  }

  function reset() {
    seq++
    data.value = null
    error.value = ''
    loading.value = false
  }

  return { data, loading, error, run, reset }
}
