/**
 * GeoVis 数字地球封装（基于项目 public/GeoVis.js 中的 Cesium 定制版）。
 *
 * window.GeoVis 由 index.html 中的 <script src="/GeoVis.js"> 同步加载，
 * 命名空间下暴露 Cesium 兼容类（Cartesian3 / Viewer 等价物 Earth 等）以及
 * GeoVis 特有类（GeoVisTerrainProvider / TileLayer 等）。
 *
 * 本文件的 Cesium 指向 GeoVis，业务 SDK（sdk/*.js）同样以 `const Cesium = window.GeoVis`
 * 复用同一套 API，因此体渲染 / 声线 / 方位指针等无需改动数据渲染逻辑。
 */
import { installTerrainWorkerCompatibility } from './terrainWorkerCompatibility.js'
const Cesium = window.GeoVis

// GeoVis 静态资源（Workers/Assets）基路径，与 public/ 下目录对应
window.CESIUM_BASE_URL = '/'

// 影像底图：与参考工程 Acoustic_Field_Display.html 的 baseImageUrl 一致，
// 使用本地 /tiles/img/{z}/{x}/{y}.png（已拷贝到 public/tiles/img）。
const BASE_MAP_URL = '/tiles/img/{z}/{x}/{y}.png'
// 近地高清卫星影像：本地 /tiles/img 只缓存到 7 级，可用额外的近距离底图补充。
// 默认不加载：Google 瓦片既无 CORS 头、在内网/国内环境也普遍不可达（会刷 ETIMEDOUT）。
// 需要时用 VITE_DETAIL_MAP_URL 指向可达的**同源 / 内网**影像服务
// （例如内网瓦片服务，或经 vite.config.js 代理后的 '/gmap/...'）。
const DETAIL_MAP_URL = import.meta.env.VITE_DETAIL_MAP_URL || ''

let earth = null

// Cesium/GeoVis 1.73 can create WebGL2 programs containing sampler3D, but its
// uniform dispatcher predates WebGL2 and only recognizes SAMPLER_2D/CUBE.
// Present sampler3D uniforms to that dispatcher as sampler2D; the dispatcher
// still binds the texture object's own _target (TEXTURE_3D), so sampling stays
// fully three-dimensional while the rest of GeoVis remains untouched.
function installSampler3DUniformCompatibility(scene) {
  const gl = scene?.context?._gl || scene?.context?.gl
  if (!gl || typeof gl.texImage3D !== 'function' || gl.__sampler3DUniformCompat) return
  const getActiveUniform = gl.getActiveUniform.bind(gl)
  gl.getActiveUniform = (program, index) => {
    const info = getActiveUniform(program, index)
    if (!info || info.type !== gl.SAMPLER_3D) return info
    return { name: info.name, size: info.size, type: gl.SAMPLER_2D }
  }
  Object.defineProperty(gl, '__sampler3DUniformCompat', { value: true })
}

/**
 * 星空贴图基路径：与参考工程 Acoustic_Field_Display 一致，
 * 使用 Version2_dark_ 六面贴图（已从参考工程拷贝到 public/Assets/Textures/SkyBox）。
 */
const SKY_BOX_BASE = '/Assets/Textures/SkyBox/Version2_dark_'

/**
 * 用参考工程同款 Version2_dark_ 贴图重建 skyBox，还原其星空效果。
 * @param {object} scene GeoVis scene
 */
function installStarSkyBox(scene) {
  if (!scene || !Cesium?.SkyBox) return
  try {
    scene.skyBox = new Cesium.SkyBox({
      sources: {
        positiveX: `${SKY_BOX_BASE}px.jpg`,
        negativeX: `${SKY_BOX_BASE}mx.jpg`,
        positiveY: `${SKY_BOX_BASE}py.jpg`,
        negativeY: `${SKY_BOX_BASE}my.jpg`,
        positiveZ: `${SKY_BOX_BASE}pz.jpg`,
        negativeZ: `${SKY_BOX_BASE}mz.jpg`,
      },
    })
    scene.skyBox.show = true
  } catch (err) {
    console.warn('[Cesium] 星空图层初始化失败：', err?.message ?? err)
  }
}

/**
 * 创建一个 GeoVis 数字地球实例（等价于 Cesium.Viewer）。
 * @param {HTMLElement|string} container 容器 DOM 元素或元素 id
 * @returns {GeoVis.Earth}
 */
export function createCesiumViewer(container, options = {}) {
  if (!Cesium) {
    throw new Error('GeoVis 未加载：请确认 index.html 已引入 /GeoVis.js')
  }

  const el = typeof container === 'string' ? document.getElementById(container) : container
  const earthTarget = el?.id || el
  installTerrainWorkerCompatibility(Cesium)
  const e = new Cesium.Earth(earthTarget, {
    scene3DOnly: false,
    // sampler3D volume rendering requires WebGL2. GeoVis 1.73 translates its
    // built-in GLSL sources for WebGL2, so the globe and the volume can share
    // the same context.
    contextOptions: { requestWebgl2: options.requestWebgl2 !== false },
  })
  installSampler3DUniformCompatibility(e.scene)
  // GeoVis 默认星空贴图（Assets/Textures/SkyBox/Version2_dark_*）未随本项目打包，
  // 导致看不到星空；这里用项目已提供的 tycho 星空贴图重建 skyBox。
  if (options.starSkyBox !== false) installStarSkyBox(e.scene)
  if (options.assignGlobal !== false) window.earth = e

  // 影像底图
  if (options.baseMap !== false) {
    new Cesium.TileLayer(BASE_MAP_URL, {
      projection: 'EPSG:900913',
      // public/tiles/img only includes 0–7.
      maxLevel: 7,
    }).addTo(e.layers)
  }

  // Enable high-resolution satellite imagery only when the camera approaches
  // the surface. Cesium imagery providers with minimumLevel=8 render white
  // placeholder ancestors, so keep this provider at its natural level 0 and
  // toggle the layer by camera distance instead.
  let detailLayer = null
  e.scene.postRender.addEventListener(() => {
    if (options.detailMap === false || !DETAIL_MAP_URL) return
    const height = e.camera.positionCartographic?.height
    if (!Number.isFinite(height)) return
    if (height < 1500000 && !detailLayer) {
      try {
        const provider = new Cesium.UrlTemplateImageryProvider({
          url: DETAIL_MAP_URL,
          tilingScheme: new Cesium.WebMercatorTilingScheme(),
          maximumLevel: 18,
        })
        detailLayer = e.imageryLayers.addImageryProvider(provider)
      } catch (error) {
        console.warn('近地影像图层不可用', error)
      }
    }
    if (detailLayer) {
      if (height < 1500000) detailLayer.show = true
      else if (height > 1800000) detailLayer.show = false
    }
  })

  // 适当放宽瓦片细分并关闭昂贵的全屏抗锯齿，
  // 在拖动/滚轮缩放时可显著减少低端显卡的逐帧压力。
  if (e.scene?.globe) e.scene.globe.maximumScreenSpaceError = 3
  if (e.scene && 'fxaa' in e.scene) e.scene.fxaa = false

  // 暂时不接入内网 GeoVis 地形服务，统一使用椭球地形。
  e.scene.terrainProvider = new Cesium.EllipsoidTerrainProvider()

  // 初始以更远的北极俯视视角展示完整数字地球。
  if (options.initialView !== false) {
    e.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(90, 90, 23000000),
    })
  }

  return e
}

/**
 * 单例初始化（供主地图复用）。
 * @param {HTMLElement|string} container
 * @returns {GeoVis.Earth}
 */
export function initCesium(container) {
  if (earth && !earth.isDestroyed?.()) {
    return earth
  }
  earth = createCesiumViewer(container)
  return earth
}

/** 获取已初始化的地球实例 */
export function getCesiumViewer() {
  return earth
}

/** 销毁地球 */
export function destroyCesium() {
  if (earth) {
    earth.destroy?.()
    earth = null
  }
}

export { Cesium }
