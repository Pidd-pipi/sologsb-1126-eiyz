/** 营位与因子评估的本地读写。写库前统一脱掉响应式 Proxy，避免 DataCloneError。 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { db, toPlain } from '@/utils/db'
import type { Campsite } from '@/types/campsite'
import type { FactorAssessment } from '@/types/factor'
import type { SiteClosure } from '@/types/closure'
import { closureStateOf, isClosureActive } from '@/types/closure'
import { nextSerialNo, nowIso, todayIso } from '@/utils/format'

export const useSiteStore = defineStore('site', () => {
  const list = ref<Campsite[]>([])
  const factors = ref<FactorAssessment[]>([])
  const closures = ref<SiteClosure[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    try {
      list.value = await db.sites.orderBy('code').toArray()
      factors.value = await db.factors.toArray()
      closures.value = await db.closures.toArray()
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

  /**
   * 删除营位：因子、否决、封营资料（含历史）一并清掉。
   * 营位不再保留时，封营资料跟着清掉，不留孤儿记录。
   */
  async function removeSite(id: number): Promise<void> {
    const own = factors.value.filter((f) => f.siteId === id)
    await db.factors.bulkDelete(
      own.map((f) => f.id).filter((v): v is number => typeof v === 'number')
    )
    const vetoIds = (await db.vetos.where('siteId').equals(id).toArray())
      .map((v) => v.id)
      .filter((v): v is number => typeof v === 'number')
    await db.vetos.bulkDelete(vetoIds)
    const closureIds = (await db.closures.where('siteId').equals(id).toArray())
      .map((c) => c.id)
      .filter((v): v is number => typeof v === 'number')
    await db.closures.bulkDelete(closureIds)
    await db.sites.delete(id)
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

  /* -------------------------------- 封营 -------------------------------- */

  /** 某营位的全部封营记录，按封营日期倒序（最新在前）。 */
  function closuresOf(siteId: number | null | undefined): SiteClosure[] {
    if (siteId == null) return []
    return closures.value
      .filter((c) => c.siteId === siteId)
      .sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1))
  }

  /** 某营位最新一条封营记录（无论是否已恢复）。 */
  function latestClosureOf(siteId: number | null | undefined): SiteClosure | null {
    return closuresOf(siteId)[0] ?? null
  }

  /** 某营位当前生效的封营记录（未恢复，含逾期未恢复）；无则返回 null。 */
  function activeClosureOf(siteId: number | null | undefined, today = todayIso()): SiteClosure | null {
    if (siteId == null) return null
    return closures.value.find((c) => c.siteId === siteId && isClosureActive(c, today)) ?? null
  }

  function closureStateOfSite(siteId: number | null | undefined, today = todayIso()) {
    const c = activeClosureOf(siteId, today)
    return c ? closureStateOf(c, today) : null
  }

  /** 封营：填写原因与计划恢复日期；已在封营中的营位不能重复封营。 */
  async function closeSite(input: {
    siteId: number
    reasonType: SiteClosure['reasonType']
    reason: string
    operator: string
    closedAt: string
    plannedReopenDate: string
  }): Promise<number> {
    if (activeClosureOf(input.siteId)) {
      throw new Error('该营位已在封营中，请先恢复后再操作')
    }
    const now = nowIso()
    const record = toPlain({
      siteId: input.siteId,
      reasonType: input.reasonType,
      reason: input.reason.trim(),
      operator: input.operator.trim() || '未署名',
      closedAt: input.closedAt || todayIso(),
      plannedReopenDate: input.plannedReopenDate,
      reopened: false,
      reopenedAt: '',
      reopenOperator: '',
      reopenNote: '',
      createdAt: now,
      updatedAt: now
    }) as SiteClosure
    const id = await db.closures.add(record)
    await load()
    return id
  }

  /** 恢复营位：可在计划恢复日期之前提前恢复，也可逾期后补恢复。 */
  async function reopenSite(
    closureId: number,
    payload: { reopenedAt: string; operator: string; note?: string }
  ): Promise<void> {
    await db.closures.update(closureId, {
      reopened: true,
      reopenedAt: payload.reopenedAt || todayIso(),
      reopenOperator: payload.operator.trim() || '未署名',
      reopenNote: payload.note?.trim() ?? '',
      updatedAt: nowIso()
    })
    await load()
  }

  /** 清空某营位的全部封营记录（随营位删除级联调用，正常流程不暴露）。 */
  async function removeClosuresOfSite(siteId: number): Promise<void> {
    await db.closures.where('siteId').equals(siteId).delete()
    await load()
  }

  const camps = computed(() => Array.from(new Set(list.value.map((s) => s.campName))))
  const total = computed(() => list.value.length)

  /** 当前处于封营中的营位 id（含逾期未恢复），名次表与地图据此排除。 */
  const closedSiteIds = computed<number[]>(() => {
    const today = todayIso()
    return Array.from(
      new Set(
        closures.value.filter((c) => isClosureActive(c, today)).map((c) => c.siteId)
      )
    )
  })

  /** 当前在营、可参与推荐排名的营位。 */
  const openSites = computed<Campsite[]>(() => {
    const closed = new Set(closedSiteIds.value)
    return list.value.filter((s) => typeof s.id === 'number' && !closed.has(s.id))
  })

  const closureTotal = computed(() => closures.value.length)

  return {
    list,
    factors,
    closures,
    loading,
    loaded,
    total,
    camps,
    closedSiteIds,
    openSites,
    closureTotal,
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
    closuresOf,
    latestClosureOf,
    activeClosureOf,
    closureStateOfSite,
    closeSite,
    reopenSite,
    removeClosuresOfSite
  }
})
