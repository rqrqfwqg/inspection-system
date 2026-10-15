/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, never>, Record<string, never>, any>
  export default component
}

interface ImportMetaEnv {
  /** 后端 API 基地址（.env.development / .env.production） */
  readonly VITE_API_BASE_URL: string
  /** 设备资产巡检系统（inspection-system）接口基地址，形如 https://www.xmgl-123.cn/ops/api */
  readonly VITE_ASSET_API_BASE?: string
  /** 微信订阅消息模板 ID：领用成功通知 */
  readonly VITE_WX_TPL_CLAIM?: string
  /** 微信订阅消息模板 ID：工单归还提醒（每日 8:00/20:00） */
  readonly VITE_WX_TPL_REMIND?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
