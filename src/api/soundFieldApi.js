/**
 * 声场计算门户接口封装（XWOcean 统一入口 POST /，同步计算后直接返回结果）。
 *
 * 请求体由门户后端 dispatcher 校验：
 *   {
 *     "Technical Support": "XWOcean",
 *     "Data": {
 *       "SN": 16,
 *       "Units": [{ "Plugin": "Analyse3DTLRD", "Request": { ...计算参数... } }]
 *     }
 *   }
 *
 * 响应体（backend_worker._wrap_portal_response）：
 *   {
 *     "Data": {
 *       "Units": [{ "Plugin": "...", "Response": { ...业务结果... }, "ResultCode": 0 }]
 *     }
 *   }
 *   ResultCode 0 = 成功，1 = 失败（Response 为 { ok: false, message }）。
 */

import { getJson, postJson } from './httpClient.js'
import { portalApiUrl } from '../config/runtimeConfig.js'

/**
 * 声场/声线求解可能明显长于普通数据接口，单独给 10 分钟等待时间。
 * 其他门户接口仍使用全局 120 秒配置，避免普通请求长期无响应。
 */
export const SOUND_FIELD_TIMEOUT_MS = 600_000

export function portalTimeoutMs(plugin) {
  return /TLRD|RTRD|ImpulseResponse/.test(String(plugin || ''))
    ? SOUND_FIELD_TIMEOUT_MS
    : undefined
}

/**
 * 与后端 `_PORTAL_COMMON_EXAMPLE` 对齐的通用缺省参数。
 * 水体环境固定由后端 HYCOM 服务读取；rtime 需与 time 一致，rtimeRes 固定 0。
 */
export function defaultCommonParams() {
  return {
    coordX: 116,
    coordY: 16,
    dataSource: 'HYCOM',
    dataType: 'DT_ENV_SOUND',
    time: '2025-01-04 12:00:00',
    timeRes: 0,
    rdataSource: 'HYCOM',
    rtime: '2025-01-04 12:00:00',
    srcDepth: 150,
    range: 10,
    maxFreq: 100,
    minFreq: 100,
    grazingAngle: 0,
    beamWidth: 180,
    isWaterChanged: true,
  }
}

function buildPortalRequest(sn, plugin, requestPayload) {
  return {
    'Technical Support': 'XWOcean',
    Data: {
      SN: sn,
      TaskId: '',
      SelfOrder: 0,
      Units: [
        {
          Plugin: plugin,
          Request: requestPayload,
        },
      ],
    },
  }
}

/**
 * 门户请求按调用方直接并行发出，不再在前端串行排队。
 * 若后端仍偶发临时文件占用错误，则在单次请求内部做有限次退避重试。
 */

/** 可重试的后端临时文件占用错误（WinError 32 / 文件被占用） */
const PORTAL_RETRYABLE = /WinError\s*32|另一个程序正在使用此文件|being used by another process/i

/**
 * 发起一次门户同步计算，成功返回完整门户响应（含 Data.Units[].Response），失败抛错。
 *
 * SDK 的 `parseAnalyse3DTlrd` / `parseAnalyse2DRtrd` 均按完整门户结构（Data.Units）解析，
 * 因此这里返回整包，保证与历史静态数据 response_Analyse3DTLRD-001.json / response_Analyse2DRTRD.json 结构一致。
 */
async function callPortalOnce(sn, plugin, requestPayload) {
  const { response: res, data: wrapped } = await postJson(
    portalApiUrl(),
    buildPortalRequest(sn, plugin, requestPayload),
    { timeoutMs: portalTimeoutMs(plugin) }
  )

  // 门户在业务校验失败时也可能返回 HTTP 500，但响应体仍是完整门户格式，
  // 其中包含可直接提示用户的原因。传输层已经优先读取响应体。

  const unit = wrapped && wrapped.Data && wrapped.Data.Units && wrapped.Data.Units[0]
  const message =
    unit?.Response?.message ||
    wrapped?.message ||
    wrapped?.detail

  if (!res.ok) {
    const reason = message ? `声场计算失败：${message}` : `声场计算接口 HTTP ${res.status}`
    const error = new Error(reason)
    error.status = res.status
    error.response = wrapped
    throw error
  }

  if (!unit || Number(unit.ResultCode) !== 0) {
    throw new Error(message ? `声场计算失败：${message}` : '声场计算失败（未知错误）')
  }

  return wrapped
}

const RETRY_DELAYS_MS = [700, 1600]

/**
 * 并行执行一次门户计算；若后端临时文件恰好被释放较慢（WinError 32），
 * 自动退避重试，仍失败才把错误抛给界面。
 */
async function callPortal(sn, plugin, requestPayload) {
  let lastError = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await callPortalOnce(sn, plugin, requestPayload)
    } catch (err) {
      lastError = err
      const retryable = PORTAL_RETRYABLE.test(err?.message || '')
      if (!retryable || attempt === RETRY_DELAYS_MS.length) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
  throw lastError ?? new Error('声场计算失败（未知错误）')
}

function withCommonParams(params) {
  const request = Object.assign(defaultCommonParams(), params)
  // 门户要求环境场时间和重构时间保持一致。
  request.rtime = request.time
  return request
}

function withoutFields(request, fields) {
  for (const field of fields) delete request[field]
  return request
}

function iceParams(params) {
  return withoutFields(withCommonParams(params), ['grazingAngle', 'beamWidth'])
}

/**
 * 后端 api_endpoints/registry.py 中固定的模型接口映射。
 * RAM / Kraken 不是 Analyse2DTLRD/Analyse3DTLRD 的请求参数，而是独立 Plugin。
 */
const MODEL_TL_PORTALS = Object.freeze({
  bellhop: Object.freeze({
    normal: Object.freeze({ '2d': [16, 'Analyse2DTLRD'], '3d': [16, 'Analyse3DTLRD'] }),
    ice: Object.freeze({ '2d': [16, 'AnalyseIce2DTLRD'], '3d': [16, 'AnalyseIce3DTLRD'] }),
  }),
  kraken: Object.freeze({
    normal: Object.freeze({ '2d': [14, 'AnalyseKraken2DTLRD'], '3d': [15, 'AnalyseKraken3DTLRD'] }),
    ice: Object.freeze({ '2d': [16, 'AnalyseIceKraken2DTLRD'], '3d': [17, 'AnalyseIceKraken3DTLRD'] }),
  }),
  ram: Object.freeze({
    normal: Object.freeze({ '2d': [16, 'Analyse2DTLRDPE'], '3d': [19, 'AnalyseRam3DTLRD'] }),
    ice: Object.freeze({ '2d': [16, 'AnalyseIce2DTLRDPE'], '3d': [21, 'AnalyseIceRam3DTLRD'] }),
  }),
})

function normalizeAcousticModel(model) {
  const normalized = String(model || 'bellhop').trim().toLowerCase()
  if (!Object.hasOwn(MODEL_TL_PORTALS, normalized)) {
    throw new Error(`不支持的声学模型：${model}`)
  }
  return normalized
}

/** 返回指定模型、维度和海区对应的门户 SN/Plugin，供界面摘要和请求共用。 */
export function portalPluginForModel(model, dimension, ice = false) {
  const normalizedModel = normalizeAcousticModel(model)
  const normalizedDimension = String(dimension).toLowerCase()
  const portal = MODEL_TL_PORTALS[normalizedModel][ice ? 'ice' : 'normal'][normalizedDimension]
  if (!portal) throw new Error(`不支持的声场维度：${dimension}`)
  return { sn: portal[0], plugin: portal[1] }
}

/** 按所选模型调用二维传播损失接口。RAM/Kraken 与 Bellhop 返回相同标准 TL 结构。 */
export function analyse2dTLRDByModel(params, model = 'bellhop', ice = false) {
  const { sn, plugin } = portalPluginForModel(model, '2d', ice)
  const request = ice ? iceParams(params) : withCommonParams(params)
  // 冰区二维 TL 协议不接收 lineCount；RAM/Kraken 本身也不产生声线。
  // 二维 TL 协议不接收 lineCount；声线条数只对二维声线接口生效。
  const removed = ['row', 'col', 'sector', 'lineCount']
  return callPortal(sn, plugin, withoutFields(request, removed))
}

/** 按所选模型调用三维传播损失接口。 */
export function analyse3dTLRDByModel(params, model = 'bellhop', ice = false) {
  const { sn, plugin } = portalPluginForModel(model, '3d', ice)
  const request = ice ? iceParams(params) : withCommonParams(params)
  const removed = ice
    ? ['azimuth', 'lineCount']
    : ['rtimeRes', 'azimuth', 'lineCount']
  return callPortal(sn, plugin, withoutFields(request, removed))
}

/** 三维传播损失 (SN=16 → Analyse3DTLRD)。params 覆盖 / 补充通用缺省字段。 */
export function analyse3dTLRD(params) {
  return analyse3dTLRDByModel(params, 'bellhop', false)
}

/**
 * 指定收发位置的原生到达结构。到达结构始终由 Bellhop arrivals 计算，
 * 与三维声场选择 Bellhop、RAM 或 KRAKEN 相互独立。
 */
export function analyseChannelImpulseResponse(params) {
  const request = withCommonParams(params)
  return callPortal(24, 'AnalyseChannelImpulseResponse', withoutFields(request, [
    'rdataSource', 'rtime', 'rtimeRes', 'range', 'grazingAngle', 'beamWidth',
    'isWaterChanged', 'sector', 'lineCount', 'row', 'col',
  ]))
}

/** 冰区三维传播损失 (SN=16 → AnalyseIce3DTLRD)。 */
export function analyseIce3dTLRD(params) {
  return analyse3dTLRDByModel(params, 'bellhop', true)
}

/** 二维传播损失 (SN=16 → Analyse2DTLRD)。 */
export function analyse2dTLRD(params) {
  return analyse2dTLRDByModel(params, 'bellhop', false)
}

/** 冰区二维传播损失 (SN=16 → AnalyseIce2DTLRD)。 */
export function analyseIce2dTLRD(params) {
  return analyse2dTLRDByModel(params, 'bellhop', true)
}

export const analyseKraken2dTLRD = (params) => analyse2dTLRDByModel(params, 'kraken', false)
export const analyseKraken3dTLRD = (params) => analyse3dTLRDByModel(params, 'kraken', false)
export const analyseIceKraken2dTLRD = (params) => analyse2dTLRDByModel(params, 'kraken', true)
export const analyseIceKraken3dTLRD = (params) => analyse3dTLRDByModel(params, 'kraken', true)
export const analyseRam2dTLRD = (params) => analyse2dTLRDByModel(params, 'ram', false)
export const analyseRam3dTLRD = (params) => analyse3dTLRDByModel(params, 'ram', false)
export const analyseIceRam2dTLRD = (params) => analyse2dTLRDByModel(params, 'ram', true)
export const analyseIceRam3dTLRD = (params) => analyse3dTLRDByModel(params, 'ram', true)

/** 二维声线轨迹 (SN=19 → Analyse2DRTRD)。params 覆盖 / 补充通用缺省字段。 */
/** 当前前端只保留非冰区环境噪声。 */
export function analyseEnvironmentNoise(params) {
  return callPortal(16, 'AnalyseEnvironmentNoise', params)
}

function directEndpoint(path) {
  return new URL(String(path).replace(/^\//, ''), portalApiUrl()).toString()
}

function directApiError(name, response, data) {
  const detail = data?.detail || data?.message || data?.Response?.message
  return new Error(detail ? `${name}失败：${detail}` : `${name}接口 HTTP ${response.status}`)
}

/**
 * 浏览器直接 GET 实时 AIS。默认返回当前时刻向前五分钟的滚动船舶快照；
 * 参数留空时查询全球范围，密钥不会下发到浏览器。
 */
export async function getRealtimeAis(params = {}) {
  const url = new URL(directEndpoint('GetRealtimeAIS'))
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const { response, data } = await getJson(url.toString(), { timeoutMs: 45_000 })
  if (!response.ok || !data || !Array.isArray(data.vessels)) throw directApiError('AIS 获取', response, data)
  return data
}

/** 固定前端 AIS 快照，并由后端天气接口生成 48 小时 Wenz 噪声帧。 */
export async function analyseForecastEnvironmentNoise(params) {
  const { response, data } = await postJson(
    directEndpoint('AnalyseForecastEnvironmentNoise'),
    params,
    { timeoutMs: 180_000 }
  )
  if (!response.ok || !data || !Array.isArray(data.frames)) {
    throw directApiError('天气噪声预报', response, data)
  }
  return data
}

/** 获取一个预报整点的 3×3 区域风、雨与海况网格。 */
export async function getRegionalWeatherForecast(params) {
  const { response, data } = await postJson(
    directEndpoint('GetRegionalWeatherForecast'),
    params,
    { timeoutMs: 180_000 }
  )
  if (!response.ok || !data || !data.grid || !data.data) {
    throw directApiError('区域天气预报', response, data)
  }
  return data
}

/** 二维声线轨迹 (SN=19 → Analyse2DRTRD)。params 覆盖 / 补充通用缺省字段。*/
export function analyse2dRTRD(params) {
  return callPortal(
    19,
    'Analyse2DRTRD',
    withoutFields(withCommonParams(params), ['row', 'col', 'sector', 'seaState', 'coherent'])
  )
}

/** 冰区二维声线轨迹 (SN=19 → AnalyseIce2DRTRD)。 */
export function analyseIce2dRTRD(params) {
  return callPortal(
    19,
    'AnalyseIce2DRTRD',
    withoutFields(iceParams(params), ['row', 'col', 'sector', 'seaState', 'coherent'])
  )
}

/**
 * 二维动态声线轨迹 (SN=19 → Analyse2DRTRDDynamic)。
 * 请求体与 `analyse2dRTRD` 完全一致；响应额外包含 `frames`，每帧给出
 * 每条声线当前可见的 `x`（水平距离，米）和 `z`（深度，米）数组。
 */
export function analyse2dDynamicRTRD(params) {
  return callPortal(
    19,
    'Analyse2DRTRDDynamic',
    withoutFields(withCommonParams(params), ['row', 'col', 'sector', 'seaState', 'coherent'])
  )
}

/** 冰区二维动态声线轨迹 (SN=19 → AnalyseIce2DRTRDDynamic)，请求体同 `analyseIce2dRTRD`。 */
export function analyseIce2dDynamicRTRD(params) {
  return callPortal(
    19,
    'AnalyseIce2DRTRDDynamic',
    withoutFields(iceParams(params), ['row', 'col', 'sector', 'seaState', 'coherent'])
  )
}

/** 三维动态声线轨迹 (SN=19 → Analyse3DRTRDDynamic)，一次返回全部扇面的静态与动态声线。 */
export function analyse3dDynamicRTRD(params) {
  return callPortal(19, 'Analyse3DRTRDDynamic', withCommonParams(params))
}

/** 冰区三维动态声线轨迹 (SN=19 → AnalyseIce3DRTRDDynamic)。 */
export function analyseIce3dDynamicRTRD(params) {
  return callPortal(19, 'AnalyseIce3DRTRDDynamic', iceParams(params))
}

/**
 * 区域环境切片 (SN=145 → GetEnvDataRegion)。
 * 海冰厚度查询使用 `DT_ENV_ICE_THICKNESS`，返回 `row × col` 网格。
 */
export function getEnvDataRegion(params) {
  return callPortal(145, 'GetEnvDataRegion', params)
}

/**
 * 航线环境数据 (SN=110 → GetEnvDataRoute)。
 *
 * 请求体：{ dataSource, dataType, time, timeRes, points: [{ x: lon, y: lat }] }。
 * 底质类型查询使用 `DT_ENV_GEOACOUSTIC_CLASSID`，响应中的
 * `ProfileData.data[i].y` 即该航线点的 `lithology_class_id`。
 */
export function getEnvDataRoute(params) {
  return callPortal(110, 'GetEnvDataRoute', params)
}

/** 单站环境查询，SN 与后端 registry.py 一致。 */
export function getEnvDataStation(params) {
  return callPortal(22, 'GetEnvDataStation', params)
}

export function getDataTypeMetaInfo() {
  return callPortal(1, 'GetDataTypeMetaInfo', {})
}

/** 指定数据集的可用时次 (SN=2)。 */
export function getDatasetTimeList(dataSource) {
  return callPortal(2, 'FetchTimeToList', {
    dataSource,
    isEnv: true,
    queryDataInMonth: 0,
  })
}
