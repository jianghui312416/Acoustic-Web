const Cesium = window.GeoVis

/** TL 分贝 → 颜色（用于点云与体渲染） */
export function colorByTl(tl) {
  if (!Number.isFinite(tl)) return null
  // 低于 60 dB 时与 60 dB 同色（保持色带下边界一致）
  if (tl < 60) return Cesium.Color.fromCssColorString('#00cccc').withAlpha(0.85)
  if (tl < 70) return Cesium.Color.fromCssColorString('#00cccc').withAlpha(0.85)
  if (tl < 80) return Cesium.Color.fromCssColorString('#66ff00').withAlpha(0.85)
  if (tl < 90) return Cesium.Color.fromCssColorString('#ffee00').withAlpha(0.85)
  if (tl < 100) return Cesium.Color.fromCssColorString('#ff9900').withAlpha(0.85)
  if (tl < 120) return Cesium.Color.fromCssColorString('#ff2200').withAlpha(0.85)
  return Cesium.Color.fromCssColorString('#cc00ff').withAlpha(0.85)
}

/**
 * TL 色带控制点（归一化 0–1 → RGB 0–255）。
 * 与体渲染 shader 的 getVolumeColorRedBlue 及声线 segmentColor 保持一致的 6 段色标。
 */
export const VOLUME_TL_COLOR_STOPS = [
  [0.0, [255, 40, 0]],
  [0.2, [255, 230, 40]],
  [0.4, [0, 220, 90]],
  [0.6, [0, 220, 255]],
  [0.8, [0, 80, 255]],
  [1.0, [0, 0, 127]],
]

/**
 * 校验并规范化色标数组。
 *
 * 接受 `[t, [r,g,b]]` 数组，t 为归一化位置（0–1），rgb 为 0–255。
 * 会按 t 升序排序、把 t 裁剪到 [0,1]、把 rgb 裁剪到 [0,255] 并取整，
 * 确保首尾分别落在 0 与 1（不足 2 个控制点时用默认色标兜底）。
 *
 * @param {Array<[number, [number, number, number]]>} stops 色标数组
 * @returns {Array<[number, [number, number, number]]>} 规范化后的色标数组
 */
export function normalizeColorStops(stops) {
  if (!Array.isArray(stops) || stops.length < 2) {
    return VOLUME_TL_COLOR_STOPS.map(([t, c]) => [t, [...c]])
  }
  const cleaned = stops
    .filter(
      (s) =>
        Array.isArray(s) &&
        Number.isFinite(Number(s[0])) &&
        Array.isArray(s[1]) &&
        s[1].length >= 3
    )
    .map(([t, c]) => [
      Math.max(0, Math.min(1, Number(t))),
      [
        Math.max(0, Math.min(255, Math.round(Number(c[0]) || 0))),
        Math.max(0, Math.min(255, Math.round(Number(c[1]) || 0))),
        Math.max(0, Math.min(255, Math.round(Number(c[2]) || 0))),
      ],
    ])
    .sort((a, b) => a[0] - b[0])

  if (cleaned.length < 2) {
    return VOLUME_TL_COLOR_STOPS.map(([t, c]) => [t, [...c]])
  }
  // 确保首尾覆盖 0 与 1，便于 shader 插值
  cleaned[0][0] = 0
  cleaned[cleaned.length - 1][0] = 1
  return cleaned
}

/**
 * 根据归一化 t（0–1）在色带控制点间线性插值，返回 [r,g,b] 0–255。
 * @param {number} t 归一化位置 0–1
 * @param {Array<[number, [number, number, number]]>} [stops] 色标数组，缺省用 VOLUME_TL_COLOR_STOPS
 */
export function sampleTlColorStops(t, stops = VOLUME_TL_COLOR_STOPS) {
  const normalized = normalizeColorStops(stops)
  const x = Math.max(0, Math.min(1, t))
  for (let i = 0; i < normalized.length - 1; i++) {
    const [t0, c0] = normalized[i]
    const [t1, c1] = normalized[i + 1]
    if (x <= t1 || i === normalized.length - 2) {
      const span = Math.max(0.000001, t1 - t0)
      const f = Math.max(0, Math.min(1, (x - t0) / span))
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ]
    }
  }
  const last = normalized[normalized.length - 1]
  return last[1]
}

/**
 * 由色标生成 CSS 渐变字符串（用于图例条）。
 * @param {Array<[number, [number, number, number]]>} [stops] 色标数组
 * @returns {string} 形如 `linear-gradient(to right, ...)`
 */
export function buildTlGradient(stops = VOLUME_TL_COLOR_STOPS) {
  const normalized = normalizeColorStops(stops)
  const parts = normalized.map(
    ([t, c]) =>
      `#${c[0].toString(16).padStart(2, '0')}${c[1].toString(16).padStart(2, '0')}${c[2].toString(16).padStart(2, '0')} ${(t * 100).toFixed(0)}%`
  )
  return `linear-gradient(to right, ${parts.join(', ')})`
}

/**
 * TL → 红(小)–蓝(大) 连续色带；NaN 返回白色
 * @param {Array<[number, [number, number, number]]>} [stops] 色标数组
 */
export function colorByTlRedBlue(tl, tlMin, tlMax, alpha = 0.85, stops = VOLUME_TL_COLOR_STOPS) {
  if (!Number.isFinite(tl)) {
    return Cesium.Color.WHITE.withAlpha(alpha)
  }
  const span = tlMax - tlMin
  const t = span > 0 ? Math.max(0, Math.min(1, (tl - tlMin) / span)) : 0.5
  const [r, g, b] = sampleTlColorStops(t, stops)
  return new Cesium.Color(r / 255, g / 255, b / 255, alpha)
}

/** 体渲染：60–120 dB 红→蓝，范围外为白色 */
export const VOLUME_TL_COLOR_MIN = 60
export const VOLUME_TL_COLOR_MAX = 120

export const VOLUME_TL_LEGEND = {
  gradient: buildTlGradient(),
  inRangeMin: VOLUME_TL_COLOR_MIN,
  inRangeMax: VOLUME_TL_COLOR_MAX,
  outOfRangeLabel: '范围外（白）',
  outOfRangeColor: '#ffffff',
}

/** 单色蓝模式图例：TL 60–120 浅蓝→深蓝 */
export const VOLUME_TL_BLUE_LEGEND = {
  gradient: 'linear-gradient(to right, #8ec8ff, #0a3d8f)',
  inRangeMin: VOLUME_TL_COLOR_MIN,
  inRangeMax: VOLUME_TL_COLOR_MAX,
  outOfRangeLabel: '范围外（浅蓝）',
  outOfRangeColor: '#c8dcff',
}

/**
 * TL → 蓝色深浅（60–120 dB）；范围外/NaN 为浅蓝
 */
export function colorByTlBlueOnly(tl, tlMin, tlMax, alpha = 0.85) {
  if (!Number.isFinite(tl)) {
    return Cesium.Color.fromCssColorString('#c8dcff').withAlpha(alpha * 0.45)
  }
  if (tl < tlMin || tl > tlMax) {
    return Cesium.Color.fromCssColorString('#b8d4ff').withAlpha(alpha * 0.5)
  }
  const span = tlMax - tlMin
  const t = span > 0 ? Math.max(0, Math.min(1, (tl - tlMin) / span)) : 0.5
  const r = 0.55 * (1 - t) + 0.04 * t
  const g = 0.78 * (1 - t) + 0.22 * t
  const b = 1.0
  return new Cesium.Color(r, g, b, alpha)
}

/** 声线点渲染图例 */
export const RAY_POINT_TL_LEGEND = {
  gradient: buildTlGradient(),
  nanLabel: 'NaN（无 TL）',
  nanColor: '#ffffff',
}

/** 6 个声源轮廓色（与 TL 填色叠加区分） */
export const SOURCE_OUTLINE = [
  '#ffffff',
  '#00ffff',
  '#ff00ff',
  '#ffff00',
  '#00ff88',
  '#ff8800',
]

export const TL_LEGEND = [
  { label: '< 60 dB（强）', color: '#00cccc' },
  { label: '60 – 70', color: '#00cccc' },
  { label: '70 – 80', color: '#66ff00' },
  { label: '80 – 90', color: '#ffee00' },
  { label: '90 – 100', color: '#ff9900' },
  { label: '100 – 120（弱）', color: '#ff2200' },
  { label: '≥ 120', color: '#cc00ff' },
]
