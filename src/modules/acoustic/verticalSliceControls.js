import { reactive } from 'vue'

/**
 * 「垂直切面」控制状态（左侧侧边栏独立一级菜单）。
 * 采用与 volumeRenderingControls 相同的 reactive store 模式：
 * AppSidebar 直接 v-model，AcousticFieldView import 后 watch 同步。
 *
 * 字段语义：
 *  - showSlice          传播损失（方位剖面）窗口显隐        → terrainSliceOpen
 *  - sliceAzimuthDeg    界面罗盘方位角（0°=正北、顺时针）  → 内部切面方位角
 *  - dbMin / dbMax      二维动态传播损失颜色范围（独立于三维体渲染）
 *  - seafloorLineAndMask 海底地形线 + 海底底质掩膜（Display[1]）
 *                       关闭时海底以下区域填充 dB 范围最大值颜色
 *  - seafloorMask       海底底质掩膜（Display[2]，关闭时下方填充 dB 最大值颜色）
 *  - east90Indicator    当前方位方向线（Display[4]，海平面洋红线）
 *  - sspWindow          声速剖面窗口显隐                    → terrainProfileOpen
 *  - cursorReadout      光标读取（Display[6]，悬停显示 TL/距离/深度）
 */
export const verticalSliceControls = reactive({
  showSlice: false,
  sliceAzimuthDeg: 0,
  dbMin: 60,
  dbMax: 120,
  seafloorLineAndMask: true,
  seafloorMask: true,
  east90Indicator: true,
  sspWindow: false,
  cursorReadout: true,
})

/** 归一化方位角 / dB 范围等数值，避免越界 / NaN */
export function clampVerticalSliceControls(controls = verticalSliceControls) {
  const azimuth = Number(controls.sliceAzimuthDeg)
  controls.sliceAzimuthDeg = Number.isFinite(azimuth) ? ((Math.round(azimuth) % 360) + 360) % 360 : 0

  const clamp = (value, min, max, fallback) => {
    const number = Number(value)
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback))
  }
  controls.dbMin = clamp(controls.dbMin, 0, 199, 60)
  controls.dbMax = clamp(controls.dbMax, controls.dbMin + 1, 200, 120)
  return controls
}
