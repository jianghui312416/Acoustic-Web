import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
    proxy: {
      '/bathy': {
        target: 'https://s3.amazonaws.com',
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/bathy/, '/elevation-tiles-prod/terrarium'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // S3 会间歇性重置 keep-alive 连接（表现为偶发 500），改为每请求新建连接，
            // 避免复用被服务端关闭的陈旧 socket。
            proxyReq.setHeader('Connection', 'close')
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
