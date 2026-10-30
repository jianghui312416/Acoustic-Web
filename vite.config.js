import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function localGebcoPlugin(ncPath, pythonExecutable = 'python') {
  let worker = null
  let output = ''
  let nextId = 1
  const pending = new Map()

  const rejectPending = (error) => {
    for (const item of pending.values()) item.reject(error)
    pending.clear()
  }
  const stop = () => {
    if (worker) worker.kill()
    worker = null
    rejectPending(new Error('GEBCO 读取进程已停止'))
  }
  const start = () => {
    if (worker) return worker
    if (!existsSync(ncPath)) throw new Error(`找不到本地 GEBCO 文件：${ncPath}`)
    worker = spawn(pythonExecutable, [path.join(__dirname, 'scripts', 'gebco_subset_server.py'), ncPath], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    worker.stdout.setEncoding('utf8')
    worker.stdout.on('data', chunk => {
      output += chunk
      for (;;) {
        const newline = output.indexOf('\n')
        if (newline < 0) break
        const line = output.slice(0, newline); output = output.slice(newline + 1)
        if (!line.trim()) continue
        let message
        try { message = JSON.parse(line) } catch { continue }
        const item = pending.get(message.id)
        if (!item) continue
        pending.delete(message.id); clearTimeout(item.timer)
        if (message.error) item.reject(new Error(message.error))
        else item.resolve(message)
      }
    })
    worker.stderr.on('data', chunk => console.error(`[GEBCO] ${String(chunk).trim()}`))
    worker.once('error', error => { worker = null; rejectPending(error) })
    worker.once('exit', code => { worker = null; rejectPending(new Error(`GEBCO 读取进程已退出（${code}）`)) })
    return worker
  }
  const readSubset = request => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('读取本地 GEBCO 子网格超时'))
    }, 30000)
    pending.set(id, { resolve, reject, timer })
    start().stdin.write(`${JSON.stringify({ id, ...request })}\n`)
  })
  const middleware = async (req, res, next) => {
    if (!req.url?.startsWith('/api/gebco')) return next()
    try {
      const url = new URL(req.url, 'http://localhost')
      const request = Object.fromEntries(['west', 'east', 'south', 'north', 'resolution']
        .map(name => [name, Number(url.searchParams.get(name))]))
      if (!Object.values(request).every(Number.isFinite) || request.west >= request.east || request.south >= request.north) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        return res.end(JSON.stringify({ error: '无效的 GEBCO 选区参数' }))
      }
      const result = await readSubset(request)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=3600' })
      res.end(JSON.stringify(result))
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: error?.message || String(error) }))
    }
  }
  const configure = server => {
    server.middlewares.use(middleware)
    server.httpServer?.once('close', stop)
  }
  return { name: 'local-gebco-subsets', configureServer: configure, configurePreviewServer: configure }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const ncPath = env.GEBCO_NC_PATH || 'D:\\JD功能开发\\HYdata\\GEBCO_2026_sub_ice\\GEBCO_2026_sub_ice.nc'
  return {
  plugins: [vue(), localGebcoPlugin(ncPath, env.GEBCO_PYTHON || 'python')],
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
  }
})
