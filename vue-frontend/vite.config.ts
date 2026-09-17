import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// 运维系统整体挂到 /ops 命名空间（与 React 版一致，后端 main.py 的 DIST_DIR 指向 <项目>/dist）
// dev / preview 均代理 /ops/api 与 /ops/uploads 到本机后端 9527
export default defineConfig({
  base: '/ops/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/ops/api': { target: 'http://127.0.0.1:9527', changeOrigin: true },
      '/ops/uploads': { target: 'http://127.0.0.1:9527', changeOrigin: true },
    },
  },
  preview: {
    port: 4174,
    proxy: {
      '/ops/api': { target: 'http://127.0.0.1:9527', changeOrigin: true },
      '/ops/uploads': { target: 'http://127.0.0.1:9527', changeOrigin: true },
    },
  },
})
