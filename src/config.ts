// 前后端一致的真源：应用与 API 命名空间（/ops）
// 后端 api_router(prefix="/ops/api")、StaticFiles(/ops/assets、/ops/uploads) 与此对应。
// 改前缀时只需同步三处：后端 api_router 前缀、本文件、.env.* 的 VITE_API_URL。

/** react-router basename：前端页面挂载在 /ops 下 */
export const APP_BASE = '/ops'

/** 所有 fetch 前缀 / vite dev proxy / .env 默认值 */
export const API_BASE = '/ops/api'

/** 上传文件静态资源前缀（头像、交接班图片等） */
export const UPLOAD_BASE = '/ops/uploads'
