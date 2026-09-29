/**
 * SiteClosure（封营记录）—— 雨季或护坡检修等情况下临时封掉营位。
 *
 * 语义：
 * - 封营期间营位退出名次表与地图推荐，不计入最高分、A/B/C 等级统计；
 * - 资料（营位、因子、否决、封营记录本身）全部保留，可从「封营管理」单独入口
 *   查看原来的得分、因子与否决记录；
 * - 可在计划恢复日期之前提前恢复，也可逾期后补恢复；恢复后立即按当前方案参与排名；
 * - 营位被删除时，其全部封营资料（含历史）随站点一并清掉（siteStore 级联删除）。
 */

/** 封营原因分类 */
export type ClosureReasonType = '雨季封营' | '护坡检修' | '道路中断' | '虫害消杀' | '其他'

/** 封营记录的生命周期状态（由日期字段实时推导，不单独落库） */
export type ClosureState = 'active' | 'overdue' | 'reopened-ahead' | 'reopened-on-schedule'

export interface SiteClosure {
  /** 主键，自增 */
  id?: number
  /** 被封营的营位 id */
  siteId: number
  /** 原因分类 */
  reasonType: ClosureReasonType
  /** 详细原因说明（必填） */
  reason: string
  /** 封营操作人 */
  operator: string
  /** 封营日期（YYYY-MM-DD） */
  closedAt: string
  /** 计划恢复日期（YYYY-MM-DD，必填） */
  plannedReopenDate: string
  /** 是否已恢复 */
  reopened: boolean
  /** 实际恢复日期（YYYY-MM-DD），未恢复为空串 */
  reopenedAt: string
  /** 恢复操作人 */
  reopenOperator: string
  /** 恢复备注（可记提前恢复的原因） */
  reopenNote: string
  createdAt: string
  updatedAt: string
}

/** 封营原因可选值，供表单复用 */
export const CLOSURE_REASON_TYPES: ClosureReasonType[] = [
  '雨季封营',
  '护坡检修',
  '道路中断',
  '虫害消杀',
  '其他'
]

/** 各原因类型的填写提示，作为原因说明输入框的 placeholder */
export const CLOSURE_REASON_HINTS: Record<ClosureReasonType, string> = {
  雨季封营: '如：连续强降雨导致河道涨水，暂停扎营。',
  护坡检修: '如：东岸护坡加固施工，工期约一周。',
  道路中断: '进场道路塌方或管制，车辆人员无法进入。',
  虫害消杀: '马蜂、蜱虫消杀，或周边野生动物活动频繁。',
  其他: '说明临时封营的现场原因与预计影响。'
}

/** 各状态对应的中文文案与标签色（el-tag type） */
export const CLOSURE_STATE_META: Record<ClosureState, { label: string; tagType: 'warning' | 'danger' | 'success' | 'info' }> = {
  active: { label: '封营中', tagType: 'warning' },
  overdue: { label: '已逾期 · 待恢复', tagType: 'danger' },
  'reopened-ahead': { label: '已提前恢复', tagType: 'success' },
  'reopened-on-schedule': { label: '已按期恢复', tagType: 'info' }
}

/** 把 YYYY-MM-DD 转成当日 0 点的毫秒数，避免 ISO 时区偏移。 */
function dayMs(date: string): number {
  const t = Date.parse(`${date}T00:00:00`)
  return Number.isNaN(t) ? 0 : t
}

/** 两个日期之间相差的天数（to - from）。 */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / 86_400_000)
}

/**
 * 由记录字段推导当前状态：
 * - 未恢复且计划恢复日期早于今天 → overdue（逾期，仍处于封营中）；
 * - 未恢复 → active；
 * - 已恢复且实际恢复日期早于计划日期 → reopened-ahead；
 * - 其余已恢复 → reopened-on-schedule。
 */
export function closureStateOf(closure: SiteClosure, today: string): ClosureState {
  if (!closure.reopened) {
    return closure.plannedReopenDate && closure.plannedReopenDate < today ? 'overdue' : 'active'
  }
  return closure.reopenedAt && closure.reopenedAt < closure.plannedReopenDate
    ? 'reopened-ahead'
    : 'reopened-on-schedule'
}

/** 是否处于封营中（含逾期未恢复）。 */
export function isClosureActive(closure: SiteClosure, today: string): boolean {
  return closureStateOf(closure, today) === 'active' || closureStateOf(closure, today) === 'overdue'
}
