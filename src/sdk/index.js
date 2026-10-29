/**
 * 声场分析能力（Sound Field）
 *
 * 基于 Cesium + WebGL2 的 NC 声场（传播损失 TL）体渲染：
 *
 * - `SoundField`：门面类，封装体渲染 primitive + 声线的生命周期管理
 * - `NcPolarShaderVolume3DPrimitive` / `ShaderVolume3DPrimitive`：ray-marching 体渲染
 * - `decodeNcPolarVolumeJson` / `finalizeNcPolarVolume`：极坐标体数据解码与补全
 * - `fillInvalidVoxelRgb`：无效体素的 R/G/B 回填（消除三线性插值在无效区边界造成的 TL 稀释伪影）
 * - `parseAnalyse3DTlrd` / `decodeTlrdPolarVolume`：三维传播损失「标准格式」
 *   （`response_Analyse3DTLRD.json`，XWOcean Analyse3DTLRD）解析与体纹理转换
 * - `createVolumeRayLineCollection`：与切面同步的声线 PolylineCollection
 * - `ncHeat`：NC 栅格热力图 / 色带渲染库（2D / 3D / 矢量箭头）
 * - `tlColor`：TL 分贝 → 颜色映射与图例
 * - `ncFieldModel`：声场 NC 解析统一接口（数据源识别 / 二维全方位声场 / 距离—深度剖面 / 声线）
 */

// 门面
export { SoundField } from './SoundField.js'

// 体渲染
export {
  ShaderVolume3DPrimitive,
  WedgeShaderVolume3DPrimitive,
  NcPolarShaderVolume3DPrimitive,
  VOLUME_SLICE_MODE,
  MAX_MARCH_STEPS,
  MAX_COLOR_STOPS,
  DEFAULT_ALPHA_SCALE,
  DEFAULT_VALUE_ALPHA_RANGE,
  finalizeVolumeTexture,
  flyToVolumeBoundingSphere,
  flyToNcSliceView,
  getShellRenderProfile,
  getLonLatDistanceMeters,
  VOLUME_SURFACE_MARGIN_M,
  TL_VOLUME_LEGEND,
} from './shaderVolume3D.js'

// 体数据构建
export {
  decodeNcPolarVolumeJson,
  finalizeNcPolarVolume,
  fillInvalidVoxelRgb,
  NC_DEFAULT_SOURCE,
} from './ncVolumeBuilder.js'

// 三维传播损失返回数据（loadingTlv）→ 极坐标体
export {
  decodeTlTxtVolume,
  TL_TXT_COLOR_MIN,
  TL_TXT_COLOR_MAX,
} from './tlTxtVolume.js'

// 三维传播损失「标准格式」（Analyse3DTLRD）解析 → 结构化声场 / 极坐标体
export {
  TlrdSoundFieldData,
  parseAnalyse3DTlrd,
  parseAnalyse3DTlrdText,
  decodeTlrdPolarVolume,
  decodeTlrdVolumeFromJson,
  isTlrdValidValue,
  normalizeTlrdValue,
  TLRD_DEFAULT_SOURCE,
  TLRD_PLUGIN,
  TLRD_INVALID_WATER,
  TLRD_INVALID_SUBSTRATE,
} from './ncTlrdParser.js'

// 声线散点
export { horizDistM } from './ncRayPoints.js'

// 二维声线动态轨迹（随时间的每条声线水平 / 深度数组）
export {
  buildDynamicRayFrames,
  buildDynamicRayPaths,
  parseAnalyse2DRtrdDynamic,
  resolveDynamicRayFrames,
  sampleDynamicRayFrame,
  dynamicRayFrameAt,
  DYNAMIC_RAY_DEFAULTS,
} from './dynamicRayPaths.js'

// 声线集合
export {
  createVolumeRayLineCollection,
  createRayLineCollectionFromRays,
  groupScatterPointsByRay,
  computeRayBearingDeg,
  filterRayPointsByAzimuth,
  filterRaysByAzimuth,
  positionFromScatterPoint,
  worldToVolumeUvw,
  passesVolumeSliceUvw,
} from './volumeRayLines.js'

// 声源点上方「可拖拽方位指针」
export {
  AzimuthPointer,
  AZIMUTH_POINTER_DEFAULTS,
  normalizeAzimuth360,
  normalizeAzimuthList,
  azimuthDiffDeg,
  bearingDegFromSource,
  offsetByAzimuthDistance,
  minAzimuthSpacingDeg,
  stepAzimuth,
} from './azimuthPointer.js'

// 色带 / TL 颜色
export {
  colorByTl,
  colorByTlRedBlue,
  colorByTlBlueOnly,
  sampleTlColorStops,
  normalizeColorStops,
  buildTlGradient,
  VOLUME_TL_COLOR_MIN,
  VOLUME_TL_COLOR_MAX,
  VOLUME_TL_COLOR_STOPS,
  VOLUME_TL_LEGEND,
  VOLUME_TL_BLUE_LEGEND,
  RAY_POINT_TL_LEGEND,
  SOURCE_OUTLINE,
  TL_LEGEND,
} from './tlColor.js'

// NC 栅格热力图渲染库
export * from './ncHeat.js'

// 声场 NC 解析统一接口（数据源识别 / 二维声场 / 距离—深度剖面 / 声线）
export {
  SOUND_FIELD_SOURCE,
  RTRD_PLUGIN,
  parseAnalyse2DRtrd,
  detectSoundFieldSource,
  parseSoundFieldNc,
  buildOmniFieldModel,
  buildTlrdOmniModel,
  interpolatePolarToDisk,
  tlAt,
  buildProfileModel,
  nearestAzimuthRow,
  distanceColumns,
  profileAxisGeometry,
  seabedDepthAtDistance,
  clipRayPathsByProfile,
  collectRayPaths,
  normalize360,
  normalize180,
  compassBearingToInternalAzimuth,
  internalAzimuthToCompassBearing,
  tlrdSectorAzimuths,
  toFiniteNumber,
  validTlValue,
  nearestIndex,
  // 兼容别名（对应 web 侧迁移前的旧导出名）
  buildOmniField,
  buildTlrdOmniData,
} from './ncFieldModel.js'
