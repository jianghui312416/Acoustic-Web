import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import https from 'node:https'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const bathymetryAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 4,
  maxFreeSockets: 2,
  timeout: 15000,
})

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 让复制过来的代码里的 '@/...' 指向 src/
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    open: true,
    watch: {
      // 不监听本地临时构建/缓存/截图目录与代理错误日志，避免这些文件在
      // 构建期间被占用时触发 FSWatcher 的 EBUSY 崩溃（Node 直接退出）。
      ignored: ['**/.tmp/**', '**/.tmp_vid_frames/**', '**/*.log'],
    },
    proxy: {
      '/bathy': {
        // 使用 S3 虚拟主机端点并复用少量 TLS 连接，避免每张瓦片都重新握手导致
        // “Client network socket disconnected before secure TLS connection” 连续出现。
        target: 'https://elevation-tiles-prod.s3.amazonaws.com',
        agent: bathymetryAgent,
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/bathy/, '/terrarium'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Connection', 'keep-alive')
          })
          proxy.on('error', (err, _req, res) => {
            // 单个瓦片网络抖动时返回 502，交由前端按低分辨率重试，而不是让开发服务器崩掉。
            try { appendFileSync('bathy-proxy-error.log', `${new Date().toISOString()} ${err?.code} ${err?.message}\n`) } catch {}
            if (res && !res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
            if (res && !res.writableEnded) res.end('proxy error')
          })
        },
      },
      // Google 卫星瓦片不返回 Access-Control-Allow-Origin，浏览器直连会被 CORS 拦截。
      // 开发环境经 Vite 代理转发为同源请求，绕开该限制。
      '/gmap': {
        target: 'https://mt2.google.com',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/gmap/, ''),
      },
    },
  },
})
