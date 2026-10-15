import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { fileURLToPath, URL } from 'node:url'

// uni-app 微信小程序构建配置
// - 使用官方 @dcloudio/vite-plugin-uni 插件
// - '@' 别名指向 src 目录（与旧工程保持一致，降低迁移成本）
export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
