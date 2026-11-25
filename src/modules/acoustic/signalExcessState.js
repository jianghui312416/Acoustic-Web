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
  // 全深度模拟：开启后忽略上面的目标深度区间，使用整个水体深度范围的传播损失。
  fullDepth: false,
  band: '最大限度',
  detectionThreshold: 10,
  arrayGain: 0,
  dbMin: -40,
  dbMax: 20,
  // Pd 色标范围（%）：与 Margin 范围独立保存，可由用户编辑。
  pdMin: 0,
  pdMax: 100,
  // 信号余量波动标准差 σ；探测概率 Pd = Φ(SE / σ)。
  sigma: 6,
  // 体渲染展示口径：'margin' → Margin（dB），'pd' → Pd（%）。
  displayMode: 'margin',
  // 三色判定：Pd<25% 透明，25–50% 黑，50–75% 黄，>75% 红。
  threeColor: false,
})
