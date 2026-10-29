/**
 * 应用模块目录。
 *
 * 新增一级模块时，在这里登记模块和对应 viewKey；新增左侧子模块时，
 * 只需在 children 中增加配置，再由对应业务视图处理子模块 id。
 */
export const DEFAULT_MODULE_ID = 'acoustic-propagation'

export const moduleCatalog = Object.freeze([
  Object.freeze({
    id: DEFAULT_MODULE_ID,
    label: '体绘制',
    viewKey: 'acoustic-field',
    defaultSubmoduleId: '3d',
    children: Object.freeze([]),
  }),
])

export function findModule(moduleId) {
  return moduleCatalog.find((item) => item.id === moduleId) ?? moduleCatalog[0]
}

export function defaultSubmoduleId(moduleItem) {
  return moduleItem?.defaultSubmoduleId ?? moduleItem?.children?.[0]?.id ?? ''
}
