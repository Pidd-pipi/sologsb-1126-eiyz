/**
 * SiteClosure（封营记录）—— 雨季临时封闭或护坡检修时，营位暂停参与推荐。
 *
 * 封营是「临时下架」而非否决：得分、因子评估与否决记录全部保留，
 * 名次表 / 地图 / 等级统计不再计入，但可从封营台账单独入口查看留存数据。
 * 一条记录的 reopenAt 为空表示当前仍在封营中；提前恢复时回填 reopenAt。
 */

/** 预置封营原因（可在表单中改填自定义内容） */
export type ClosureReason = '雨季封闭' | '护坡检修' | '落石隐患排查' | '洪水预警' | '道路中断' | '其他'

export interface SiteClosure {
  /** 主键，自增 */
  id?: number
  /** 被封营的营位 id */
  siteId: number
  /** 封营原因（预置类型） */
  reason: ClosureReason
  /** 详细说明（现场情况、处置安排等） */
  detail: string
  /** 计划恢复开放日期（YYYY-MM-DD） */
  plannedReopenAt: string
  /** 实际恢复日期；为空表示仍在封营中，提前恢复时回填当日 */
  reopenAt: string | null
  /** 实际恢复说明（提前恢复原因等），恢复后回填 */
  reopenNote: string | null
  /** 封营操作人 */
  closedBy: string
  /** 恢复确认人 */
  reopenedBy: string | null
  /** 封营日期（YYYY-MM-DD） */
  closedAt: string
  createdAt: string
  updatedAt: string
}

export const CLOSURE_REASONS: ClosureReason[] = [
  '雨季封闭',
  '护坡检修',
  '落石隐患排查',
  '洪水预警',
  '道路中断',
  '其他'
]

/** 各预置原因的填写提示 */
export const CLOSURE_REASON_HINTS: Record<ClosureReason, string> = {
  雨季封闭: '连续降雨期间河道、沟口营位暂停开放，雨停并复核现场后恢复。',
  护坡检修: '护坡、排水沟或道路施工期间营位不接待帐篷，写明施工影响范围。',
  落石隐患排查: '发现落石落枝新痕迹，排查并完成排险前暂停开放。',
  洪水预警: '上游来水或山洪预警期间临时撤离，预警解除后恢复。',
  道路中断: '进出道路冲毁或管制，恢复通行前无法到达营位。',
  其他: '填写其他需要临时封营的现场原因。'
}

/**
 * 该记录是否仍在封营中：只要没填写实际恢复日期就算封营——
 * 计划恢复日期已过但尚未办理恢复时依然保持封闭（逾期只是展示提示，不自动开放）。
 */
export function isClosureActive(record: SiteClosure): boolean {
  return !record.reopenAt
}

/** 已过计划恢复日期但尚未办理恢复：仍处于封营中，仅用于展示「逾期未恢复」提示。 */
export function isClosureOverdue(
  record: SiteClosure,
  today: string = new Date().toISOString().slice(0, 10)
): boolean {
  return !record.reopenAt && !!record.plannedReopenAt && record.plannedReopenAt < today
}
