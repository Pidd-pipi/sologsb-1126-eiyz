/**
 * useRanking —— 读取营位、因子、权重与否决记录，算出归一化得分与名次。
 * 被 `/`（名次表）、`/scoring`（拖动权重实时重排）、`/map`、详情页共同消费。
 *
 * 封营语义：
 * - `sites` 传入的是**参与当前推荐**的营位集合（调用方负责排除封营中的营位），
 *   `ranked` / `best` 及一切等级统计只在这个集合内产生；
 * - `referenceSites` 可选，提供「参考全集」（在营营位 + 指定封营营位），
 *   封营营位不进名次表，但仍可通过 referenceScoreOf 看到它在当前方案下的原得分与等级。
 *
 * 入参统一用 getter 函数，兼容 ref / computed / store 派生值，
 * 内部在独立 effectScope 中求值，保证 computed 依赖追踪正常且不泄漏。
 */
import { computed, effectScope, type ComputedRef } from 'vue'
import type { Campsite } from '@/types/campsite'
import type { FactorAssessment } from '@/types/factor'
import type { FactorKey, FactorWeights, GradeThresholds, NormalizeMethod } from '@/types/score'
import {
  buildFactorRows,
  buildNormalizedMatrix,
  gradeOf,
  rawValuesOf,
  weightedTotal,
  type Grade,
  type RawFactorValues,
  type SiteScore
} from '@/utils/score'

export interface RankingInput {
  /** 参与排名的营位集合（封营中的营位不要传进来） */
  sites: () => Campsite[]
  /**
   * 参考全集：用于给封营中、不在 sites 内的营位计算「原本能拿多少分」。
   * 缺省与 sites 相同（即没有参考需求）。
   */
  referenceSites?: () => Campsite[]
  /** siteId -> 用于评分的因子记录（通常取最新一轮评估） */
  factorOf: (siteId: number) => FactorAssessment | null
  weights: () => FactorWeights
  normalize: () => NormalizeMethod
  thresholds: () => GradeThresholds
  /** 命中否决项的营位 id 集合 */
  vetoedIds: () => number[]
}

export interface RankingRow extends SiteScore {
  site: Campsite
  rank: number
  raw: RawFactorValues
  vetoTypes: string[]
}

export interface RankingState {
  /** 已按得分降序排列的名次（仅参与推荐的营位） */
  ranked: ComputedRef<RankingRow[]>
  scoreOf: (siteId: number) => RankingRow | null
  /** 参考全集下的得分行（封营营位用它查看原得分；rank 无意义，固定为 0） */
  referenceScoreOf: (siteId: number) => RankingRow | null
  gradeOfSite: (siteId: number) => Grade
  best: ComputedRef<RankingRow | null>
}

interface RankContext {
  normalize: NormalizeMethod
  weights: FactorWeights
  thresholds: GradeThresholds
  vetoSet: Set<number>
}

/** 在一批营位上完成「原始值 → 同批归一 → 加权求和 → 等级」，按总分降序。 */
function rankSites(
  sites: Campsite[],
  factorOf: (siteId: number) => FactorAssessment | null,
  ctx: RankContext
): RankingRow[] {
  const list = sites.filter((s): s is Campsite & { id: number } => typeof s.id === 'number')

  // 关键：极差归一必须**同批营位一起比较**，逐条归一的话单条样本跨度为零会全部得 100。
  // 因此先收集全部原始指标，一次性归一化，再回填到每个营位。
  const entries = list.map((site) => ({
    siteId: site.id,
    values: rawValuesOf(site, factorOf(site.id))
  }))
  const matrix = buildNormalizedMatrix(entries, ctx.normalize)

  const rows: RankingRow[] = list.map((site, idx) => {
    const siteId = site.id
    const raw = entries[idx].values
    const normalized = matrix.get(siteId) ?? ({} as Record<FactorKey, number>)
    const vetoed = ctx.vetoSet.has(siteId)
    const total = weightedTotal(normalized, ctx.weights)
    return {
      site,
      siteId,
      total,
      grade: gradeOf(total, ctx.thresholds, vetoed),
      vetoed,
      vetoTypes: [],
      rows: buildFactorRows(normalized, ctx.weights).map((row) => ({ ...row, raw: raw[row.key] })),
      raw,
      rank: 0
    } satisfies RankingRow
  })

  const sorted = rows.sort((a, b) => b.total - a.total)
  sorted.forEach((row, idx) => {
    row.rank = idx + 1
  })
  return sorted
}

export function useRanking(input: RankingInput): RankingState {
  const scope = effectScope(true)

  function currentContext(): RankContext {
    return {
      normalize: input.normalize(),
      weights: input.weights(),
      thresholds: input.thresholds(),
      vetoSet: new Set(input.vetoedIds() ?? [])
    }
  }

  const ranked = scope.run(() =>
    computed<RankingRow[]>(() => rankSites(input.sites() ?? [], input.factorOf, currentContext()))
  ) as ComputedRef<RankingRow[]>

  // 参考全集（在营 + 被查询的封营营位），仅用于展示封营营位的原得分，不参与任何统计。
  const referenceRanked = scope.run(() =>
    computed<RankingRow[]>(() => {
      const refs = input.referenceSites ? input.referenceSites() : input.sites()
      return rankSites(refs ?? [], input.factorOf, currentContext())
    })
  ) as ComputedRef<RankingRow[]>

  function scoreOf(siteId: number): RankingRow | null {
    return ranked.value.find((r) => r.siteId === siteId) ?? null
  }

  function referenceScoreOf(siteId: number): RankingRow | null {
    return referenceRanked.value.find((r) => r.siteId === siteId) ?? null
  }

  function gradeOfSite(siteId: number): Grade {
    return scoreOf(siteId)?.grade ?? 'C'
  }

  const best = scope.run(() => computed<RankingRow | null>(() => ranked.value[0] ?? null)) as
    | ComputedRef<RankingRow | null>
    | undefined

  return {
    ranked,
    scoreOf,
    referenceScoreOf,
    gradeOfSite,
    best: best ?? computed<RankingRow | null>(() => ranked.value[0] ?? null)
  }
}
