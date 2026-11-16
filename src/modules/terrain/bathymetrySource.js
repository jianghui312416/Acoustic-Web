import { reactive } from 'vue'

const STORAGE_KEY = 'acoustic-terrain-bathymetry-source'
const VALID_SOURCES = ['local', 'online']

function initialSource() {
  let stored = ''
  try { stored = globalThis.localStorage?.getItem(STORAGE_KEY) || '' } catch {}
  if (VALID_SOURCES.includes(stored)) return stored
  return import.meta.env?.VITE_BATHYMETRY_SOURCE === 'online' ? 'online' : 'local'
}

/**
 * 海底高程数据源。
 *  - local：本地 GEBCO 2026 NetCDF（通过 Vite 中间件读取，精度最高）。
 *  - online：AWS Terrain Tiles（Terrarium 编码的在线高程瓦片，无需本地文件）。
 */
export const bathymetrySourceState = reactive({
  source: initialSource(),
})

export const BATHYMETRY_SOURCE_OPTIONS = [
  {
    value: 'local',
    label: '本地 GEBCO',
    title: '本地 GEBCO 2026 NetCDF（由本地 Python 服务读取）',
    attribution: { label: 'GEBCO 2026 海底高程', href: 'https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid' },
  },
  {
    value: 'online',
    label: '在线瓦片',
    title: '在线 Terrarium 高程瓦片（AWS Terrain Tiles）',
    attribution: { label: 'AWS Terrain Tiles 在线高程', href: 'https://registry.opendata.aws/terrain-tiles/' },
  },
]

export function setBathymetrySource(source) {
  if (!VALID_SOURCES.includes(source) || bathymetrySourceState.source === source) return
  bathymetrySourceState.source = source
  try { globalThis.localStorage?.setItem(STORAGE_KEY, source) } catch {}
}
