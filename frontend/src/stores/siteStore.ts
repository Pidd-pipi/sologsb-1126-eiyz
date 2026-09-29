/** 营位与因子评估的本地读写。写库前统一脱掉响应式 Proxy，避免 DataCloneError。 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, toPlain } from '@/utils/db'
import type { Campsite } from '@/types/campsite'
import type { FactorAssessment } from '@/types/factor'
import type { SiteClosure } from '@/types/closure'
import { isClosureActive } from '@/types/closure'
import { nextSerialNo, nowIso, todayIso } from '@/utils/format'

export interface CloseSiteInput {
  reason: SiteClosure['reason']
  detail: string
  plannedReopenAt: string
  closedBy: string
  closedAt: string
}

export interface ReopenSiteInput {
  reopenAt: string
  note: string
  reopenedBy: string
}

export const useSiteStore = defineStore('site', () => {
  const list = ref<Campsite[]>([])
  const factors = ref<FactorAssessment[]>([])
  const closures = ref<SiteClosure[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      const [sites, factorRows, closureRows] = await Promise.all([
        db.sites.orderBy('code').toArray(),
        db.factors.toArray(),
        db.closures.toArray()
      ])
      list.value = sites
      factors.value = factorRows
      closures.value = closureRows
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  /** 生成下一个营位编号，如 CS-0007。 */
  function nextCode(): string {
    return nextSerialNo('CS-', list.value.map((s) => s.code))
  }

  async function createSite(input: Campsite): Promise<number> {
    const now = nowIso()
    const record = toPlain({ ...input, createdAt: now, updatedAt: now }) as Campsite
    delete record.id
    const id = await db.sites.add(record)
    await load()
    return id
  }

  async function updateSite(id: number, patch: Partial<Campsite>): Promise<void> {
    await db.sites.update(id, toPlain({ ...patch, updatedAt: nowIso() }))
    await load()
  }

  async function removeSite(id: number): Promise<void> {
    await db.sites.delete(id)
    const own = factors.value.filter((f) => f.siteId === id)
    await db.factors.bulkDelete(
      own.map((f) => f.id).filter((v): v is number => typeof v === 'number')
    )
    const vetoIds = (await db.vetos.where('siteId').equals(id).toArray())
      .map((v) => v.id)
      .filter((v): v is number => typeof v === 'number')
    await db.vetos.bulkDelete(vetoIds)
    // 营位不再保留时，封营资料跟着一并清掉
    const closureIds = closures.value
      .filter((c) => c.siteId === id)
      .map((c) => c.id)
      .filter((v): v is number => typeof v === 'number')
    await db.closures.bulkDelete(closureIds)
    await load()
  }

  async function addFactor(input: FactorAssessment): Promise<number> {
    const now = nowIso()
    const record = toPlain({
      ...input,
      assessedAt: input.assessedAt || todayIso(),
      createdAt: now,
      updatedAt: now
    }) as FactorAssessment
    delete record.id
    const id = await db.factors.add(record)
    await load()
    return id
  }

  async function removeFactor(id: number): Promise<void> {
    await db.factors.delete(id)
    await load()
  }

  /* ------------------------------- 封营管理 ------------------------------- */

  /** 封营：登记一条未恢复的封营记录。已在封营中的营位不允许重复封营。 */
  async function closeSite(siteId: number, input: CloseSiteInput): Promise<number> {
    if (activeClosureOf(siteId)) {
      throw new Error('该营位已在封营中，请先恢复后再登记')
    }
    const now = nowIso()
    const record = toPlain({
      siteId,
      reason: input.reason,
      detail: input.detail,
      plannedReopenAt: input.plannedReopenAt,
      reopenAt: null,
      reopenNote: null,
      closedBy: input.closedBy,
      reopenedBy: null,
      closedAt: input.closedAt || todayIso(),
      createdAt: now,
      updatedAt: now
    }) as SiteClosure
    const id = await db.closures.add(record)
    await load()
    return id
  }

  /** 恢复开放（支持提前恢复）：回填当前封营记录的恢复信息，营位立即重新参与排名。 */
  async function reopenSite(siteId: number, input: ReopenSiteInput): Promise<void> {
    const active = activeClosureOf(siteId)
    if (!active || typeof active.id !== 'number') {
      throw new Error('该营位当前不在封营中')
    }
    await db.closures.update(active.id, {
      reopenAt: input.reopenAt || todayIso(),
      reopenNote: input.note.trim() || null,
      reopenedBy: input.reopenedBy.trim() || '未署名',
      updatedAt: nowIso()
    })
    await load()
  }

  /** 某营位当前生效的封营记录（无则 null；逾期未恢复仍算封营中）。 */
  function activeClosureOf(siteId: number | null | undefined): SiteClosure | null {
    if (siteId == null) return null
    return closures.value.find((c) => c.siteId === siteId && isClosureActive(c)) ?? null
  }

  /** 某营位全部封营记录（含已恢复的历史），按封营日期倒序。 */
  function closuresOf(siteId: number | null | undefined): SiteClosure[] {
    if (siteId == null) return []
    return closures.value
      .filter((c) => c.siteId === siteId)
      .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))
  }

  /** 当前正在封营（含逾期未恢复）的营位 id 集合，名次表 / 地图 / 评分页统一排除。 */
  const closedSiteIds = computed<number[]>(() => {
    const ids = closures.value
      .filter((c) => !c.reopenAt && c.siteId != null)
      .map((c) => c.siteId)
    return Array.from(new Set(ids))
  })

  function isClosed(siteId: number | null | undefined): boolean {
    if (siteId == null) return false
    return closedSiteIds.value.includes(siteId)
  }

  /** 当前封营中营位数量（台账角标用）。 */
  const closedCount = computed(() => closedSiteIds.value.length)

  function byId(id: number | null | undefined): Campsite | null {
    if (id == null || Number.isNaN(id)) return null
    return list.value.find((s) => s.id === id) ?? null
  }

  /** 取某营位最新一条因子评估（按评估日期倒序）。 */
  function latestFactor(siteId: number | null | undefined): FactorAssessment | null {
    if (siteId == null) return null
    const rows = factors.value
      .filter((f) => f.siteId === siteId)
      .sort((a, b) => (a.assessedAt < b.assessedAt ? 1 : -1))
    return rows[0] ?? null
  }

  /** 取某营位全部因子评估（多轮复核对比用）。 */
  function factorsOf(siteId: number | null | undefined): FactorAssessment[] {
    if (siteId == null) return []
    return factors.value
      .filter((f) => f.siteId === siteId)
      .sort((a, b) => (a.assessedAt < b.assessedAt ? 1 : -1))
  }

  const camps = computed(() => Array.from(new Set(list.value.map((s) => s.campName))))
  const total = computed(() => list.value.length)

  return {
    list,
    factors,
    closures,
    loading,
    loaded,
    total,
    camps,
    closedSiteIds,
    closedCount,
    load,
    nextCode,
    createSite,
    updateSite,
    removeSite,
    addFactor,
    removeFactor,
    byId,
    latestFactor,
    factorsOf,
    closeSite,
    reopenSite,
    activeClosureOf,
    closuresOf,
    isClosed
  }
})
