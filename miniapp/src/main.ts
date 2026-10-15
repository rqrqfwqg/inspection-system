import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// uni-app Vue3 标准入口：必须导出 createApp 工厂函数
export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  return {
    app
  }
}
