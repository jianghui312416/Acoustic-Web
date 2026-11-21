/**
 * 影像底图配置。
 *
 * 默认使用 ArcGIS World Imagery（全球卫星影像）：无需 Key、返回 CORS 头，
 * 采用 WGS84 / Web Mercator，与声场经纬度坐标一致。
 *
 * 可用环境变量覆盖：
 *   VITE_BASE_MAP_URL        XYZ 模板，支持 {z}/{x}/{y} 占位符
 *   VITE_BASE_MAP_MAX_LEVEL  最大层级（默认 18）
 *
 * 可直接替换的模板示例：
 *   ArcGIS 卫星： https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
 *   OSM 街道：    https://tile.openstreetmap.org/{z}/{x}/{y}.png
 *   高德卫星：    https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}
 *   高德路网：    https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}
 *   本地瓦片：    /tiles/img/{z}/{x}/{y}.png（同时设 VITE_BASE_MAP_MAX_LEVEL=7）
 *
 * 注意：高德/腾讯使用 GCJ-02（火星坐标），影像相对 WGS84 有数百米偏移，
 * 与声源经纬度定位会有偏差；需要精确对位时请用 ArcGIS / OSM / 天地图。
 */
const DEFAULT_BASE_MAP_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const DEFAULT_BASE_MAP_MAX_LEVEL = 18

export function baseMapUrlTemplate() {
  const configured = String(import.meta.env.VITE_BASE_MAP_URL || '').trim()
  return configured || DEFAULT_BASE_MAP_URL
}

export function baseMapMaxLevel() {
  const configured = Number(import.meta.env.VITE_BASE_MAP_MAX_LEVEL)
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BASE_MAP_MAX_LEVEL
}

/** 把 {z}/{x}/{y} 模板替换为具体瓦片地址（供 canvas 缩略图使用）。 */
export function buildTileUrl(template, z, x, y) {
  return String(template)
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
}
