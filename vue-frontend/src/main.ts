import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

// ── 样式加载顺序（不可调换）────────────────────────────────────────────
// 1) Element Plus 基础样式：在 :root 声明 --el-* 默认值
// 2) 本项目 tokens：必须最后加载，才能以同优先级覆盖 --el-*（见 styles/tokens.css 头部）
//    依据：用户既有工程 tools-management/vue-frontend/src/main.ts 的已验证写法
import 'element-plus/dist/index.css'
import '@/styles/tokens.css'
import '@/styles/base.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// 全量注册 EP 图标（模板内 <el-icon><Search /></el-icon> 可用）
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.mount('#app')
