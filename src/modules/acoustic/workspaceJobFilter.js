/**
 * 工作区只保留真正由三维运行入口生成的多方位声场任务。
 *
 * 后端会为每次门户计算创建任务目录（包括查看二维传播损失时补算的动态声线），
 * 这些任务也可能带有单方位三维结果并出现在 /jobs 列表中。前端根据任务参数过滤：
 * - calculation_mode = 3d
 * - sound_field_view = full_3d
 * - 至少 2 个方位
 */
export function isWorkspaceFieldParams(params) {
  if (!params || typeof params !== 'object') return false
  const portal = params.portal_request && typeof params.portal_request === 'object'
    ? params.portal_request
    : {}
  const sector = Number(params.section_count ?? portal.sector)
  if (!Number.isFinite(sector) || sector <= 1) return false

  const mode = String(params.calculation_mode || '').toLowerCase()
  const view = String(params.sound_field_view || '').toLowerCase()
  if (mode) return mode === '3d' && (!view || view === 'full_3d')

  // 兼容旧任务参数：没有 calculation_mode 时，以“多扇区且不是固定单方位”判定。
  return !portal.azimuth && sector > 1
}
