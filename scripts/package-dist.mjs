import { access, copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

await access(path.join(dist, 'index.html')).catch(() => {
  throw new Error('未找到 dist/index.html，请先执行 npm run build')
})

await copyFile(path.join(root, 'scripts', 'serve_dist.py'), path.join(dist, 'serve_dist.py'))

const startBat = [
  '@echo off',
  'cd /d "%~dp0"',
  'python serve_dist.py %*',
  'pause',
  '',
].join('\r\n')
await writeFile(path.join(dist, 'start.bat'), startBat, 'utf8')

console.log('dist 已准备好，可整体复制到另一台电脑：')
console.log('  dist/serve_dist.py   同时托管前端和本地 GEBCO 接口')
console.log('  dist/start.bat       在另一台电脑双击启动')
console.log('另一台电脑需安装 Python 依赖：pip install h5py numpy')
console.log('GEBCO 路径可用 --nc 指定，或放在 dist 目录下，或使用默认路径。')
