import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  // 运维系统整体挂到 /ops 命名空间，避免与同机物料系统（/ 与 /api）冲突
  base: '/ops/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // 仅代理 API 与上传；SPA 与 /ops 下的静态资源由 vite dev 自身服务，勿代理整段 /ops
    proxy: {
      '/ops/api': {
        target: 'http://127.0.0.1:9527',
        changeOrigin: true,
      },
      '/ops/uploads': {
        target: 'http://127.0.0.1:9527',
        changeOrigin: true,
      },
    },
  },
})
