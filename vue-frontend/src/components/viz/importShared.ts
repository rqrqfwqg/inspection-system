import type { ImportResult } from '@/types/assetViz'

/** 待导入文件（含用户在界面上为该文件选择的来源模板） */
export interface PendingFile {
  id: string
  file: File
  sourceType: string
}

/** 单个文件的导入结果（成功或失败统一成一条，便于结果区逐条呈现） */
export interface FileResult extends ImportResult {
  id: string
  filename: string
  ok: boolean
  error?: string
}

/** 模板 key → 中文名（与后端 templates 接口的 key 对齐） */
export const TEMPLATE_LABEL: Record<string, string> = {
  fixed_assets: '固定资产清单',
  device_archive: '设备档案明细',
  ba_system: 'BA 系统设备',
  rooms: '机房信息汇总',
  unknown: '未识别',
}

export function templateLabel(key?: string): string {
  return key ? (TEMPLATE_LABEL[key] ?? key) : ''
}
