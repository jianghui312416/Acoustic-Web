// Copy an isolated AMD dependency closure; leave legacy geometry workers intact.
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const source = process.argv[2]
if (!source) throw new Error('Pass the compatible GeoVis Workers directory')
const destination = path.resolve('public/Workers/terrain')
const visited = new Set()
function copy(name) {
  if (visited.has(name)) return
  visited.add(name)
  const file = path.join(source, name + '.js')
  const code = readFileSync(file, 'utf8')
  const dependencies = code.match(/define\(\s*\[([^\]]*)\]/)?.[1] || ''
  for (const match of dependencies.matchAll(/['"]([^'"]+)['"]/g)) {
    if (['exports', 'require', 'module'].includes(match[1])) continue
    if (!match[1].startsWith('./')) throw new Error('Unexpected AMD dependency: ' + match[1])
    copy(path.posix.join(path.posix.dirname(name), match[1]))
  }
  const target = path.join(destination, name + '.js')
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(file, target)
}
for (const name of ['createVerticesFromHeightmap', 'createVerticesFromQuantizedTerrainMesh', 'createVerticesFromGoogleEarthEnterpriseBuffer']) copy(name)
console.log(`Copied ${visited.size} terrain worker modules`)
