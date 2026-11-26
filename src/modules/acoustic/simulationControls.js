import { reactive } from 'vue'
import { normalizeCoordFormat } from '@/utils/coordinateFormat.js'

/** 仿真模型下拉选项（与声场计算参数使用同一组模型标识）。 */
export const SIMULATION_MODELS = Object.freeze([
  Object.freeze({ id: 'bellhop', label: '射线模型' }),
  Object.freeze({ id: 'ram', label: 'PE 模型' }),
])

/**
 * 「仿真配置」控制状态（左侧侧边栏独立一级菜单）。
 * AcousticFieldView 会把这些字段与 calcParams 双向同步。
 *
 * 字段语义：
 *  - model            仿真模型（bellhop / ram）
 *  - time             仿真时间（UTC，ISO 字符串）
 *  - coordX / coordY  声源经度 / 纬度
 *  - srcDepth         声源深度（米）
 *  - frequency        运行频率（Hz）
 *  - grazingAngleMin  俯角（度）
 *  - grazingAngleMax  仰角（度）
 *  - range            传播距离（海里）
 *  - sector           方位数
 *  - lineCount        声线条数
 *  - coherent         相干性
 */
export const simulationControls = reactive({
  /** 侧边栏「仿真配置」是否展开；运行面板参数按钮也通过它打开。 */
  sidebarOpen: false,
  /** 经纬度显示格式：DD / DM / DMS。 */
  coordFormat: 'DD',
  model: 'bellhop',
  time: '2025-01-02T12:00:00',
  coordX: 116,
  coordY: 16,
  srcDepth: 150,
  frequency: 100,
  grazingAngleMin: -25,
  grazingAngleMax: 25,
  range: 10,
  sector: 4,
  lineCount: 10,
  coherent: false,
})

/** 归一化仿真配置数值，避免非法输入进入计算参数。 */
export function clampSimulationControls(controls = simulationControls) {
  const clamp = (value, min, max, fallback) => {
    const number = Number(value)
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback))
  }
  const model = SIMULATION_MODELS.some((item) => item.id === controls.model) ? controls.model : 'bellhop'
  controls.model = model
  controls.coordFormat = normalizeCoordFormat(controls.coordFormat)
  controls.coordX = clamp(controls.coordX, -180, 180, 0)
  controls.coordY = clamp(controls.coordY, -90, 90, 0)
  controls.srcDepth = clamp(controls.srcDepth, 0, 20000, 0)
  controls.frequency = clamp(controls.frequency, 1, 1000000, 100)
  controls.grazingAngleMin = clamp(controls.grazingAngleMin, -90, 90, -45)
  controls.grazingAngleMax = clamp(controls.grazingAngleMax, -90, 90, 45)
  controls.range = clamp(controls.range, 0.1, 20000, 39.6)
  controls.sector = Math.round(clamp(controls.sector, 1, 360, 4))
  controls.lineCount = Math.round(clamp(controls.lineCount, 0, 100000, 10))
  controls.coherent = Boolean(controls.coherent)
  return controls
}
