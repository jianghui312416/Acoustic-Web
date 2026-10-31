import { reactive } from 'vue'

/**
 * 信号余量（Signal Excess）参数。
 *
 * 信号余量 SE = SL − TL − NL − DT + AG：
 *  - SL 目标源级别、DT 检测阈值、AG 阵列增益、目标深度区间均来自侧边栏；
 *  - TL 取三维声场体目标深度区间内的传播损失；
 *  - NL 取「天气与环境噪声」当前选定频带的环境噪声（WENZ）值。
 */
export const signalExcessState = reactive({
  enabled: false,
  receiver: '自动 — 已选择/最新，音量为 TL',
  sourceLevel: 140,
  minDepth: 20,
  maxDepth: 100,
  band: '最大限度',
  detectionThreshold: 10,
  arrayGain: 0,
  dbMin: -60,
  dbMax: 10,
})
