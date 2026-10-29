/**
 * omniFieldModel.js（兼容层）
 * ==========================================
 * 二维全方位声场模型的解析实现已统一迁移至 `@/sdk`
 * （`analysis/soundfield/ncFieldModel.js`），本文件仅做 re-export，
 * 保证既有引用路径 `@/utils/omniFieldModel.js` 不失效。
 *
 * 新代码请直接从 SDK 引入：
 *   import { buildOmniFieldModel, tlAt, interpolatePolarToDisk } from '@/sdk'
 */
export {
  tlAt,
  interpolatePolarToDisk,
  buildOmniField,
  buildTlrdOmniData,
  // 迁移后的正式命名（推荐）
  buildOmniFieldModel,
  buildTlrdOmniModel,
} from '@/sdk'
