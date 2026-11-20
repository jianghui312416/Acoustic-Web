import { reactive } from 'vue'

/**
 * 「垂直切面」控制状态（左侧侧边栏独立一级菜单）。
 * 采用与 volumeRenderingControls 相同的 reactive store 模式：
 * AppSidebar 直接 v-model，AcousticFieldView import 后 watch 同步。
 *
 * 字段语义：
 *  - showSlice          传播损失（方位剖面）窗口显隐        → terrainSliceOpen
 *  - sliceAzimuthDeg    界面罗盘方位角（0°=正北、顺时针）  → 内部切面方位角
 *  - seafloorLineAndMask 海底地形线 + 海底底质掩膜（Display[1]）
 *                       关闭时海底以下区域填充 dB 范围最大值颜色
 *  - seafloorMask       海底底质掩膜（Display[2]，关闭时下方填充 dB 最大值颜色）
 *  - sspWindow          声速剖面窗口显隐                    → terrainProfileOpen
 *  - cursorReadout      光标读取（Display[6]，悬停显示 TL/距离/深度）
 *  - dynamicRays        动态声线开关（关闭时隐藏所有动态声线）
 *  - staticRays         静态声线开关（开启时在声场体与垂直切面显示完整声线）
 *  - raySpeed           声线播放速度倍率（0.25× ~ 8.00×）
 *  - rayTimelineMs      当前声线动画的循环时长（时间滑杆范围）
 */
export const verticalSliceControls = reactive({
  showSlice: false,
  sliceAzimuthDeg: 0,
  seafloorLineAndMask: true,
  seafloorMask: true,
  /** 裁剪体：开启后拖动方位指针箭头，隐藏箭头所指方向的半个体，露出过声源的切面。 */
  clipBody: false,
  sspWindow: false,
  cursorReadout: false,
  dynamicRays: true,
  staticRays: false,
  raySpeed: 1,
  rayTimelineMs: 8000,
})

/** 归一化方位角 / 播放速度等数值，避免越界 / NaN */
export function clampVerticalSliceControls(controls = verticalSliceControls) {
  const azimuth = Number(controls.sliceAzimuthDeg)
  // 保留实际计算方位的精度（如 360/sector 的 51.43°），仅做 0~360 归一化。
  controls.sliceAzimuthDeg = Number.isFinite(azimuth) ? ((azimuth % 360) + 360) % 360 : 0

  const clamp = (value, min, max, fallback) => {
    const number = Number(value)
    return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback))
  }
  controls.clipBody = controls.clipBody === true
  controls.raySpeed = clamp(controls.raySpeed, 0.25, 8, 1)
  controls.rayTimelineMs = clamp(controls.rayTimelineMs, 100, 600000, 8000)
  return controls
}
