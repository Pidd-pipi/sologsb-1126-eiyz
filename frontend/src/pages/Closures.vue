<script setup lang="ts">
/**
 * `/closures` 封营管理 —— 封营营位的单独入口。
 *
 * - 「当前封营」：封营中（含逾期未恢复）的营位，可提前恢复或逾期补恢复，
 *   同时保留查看原得分（参考得分）、因子轮次与否决记录的入口；
 * - 「封营历史」：历次已恢复记录（提前 / 按期）；
 * - 封营中的营位不参与名次表、地图的推荐、最高分与等级统计。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import GradeBadge from '@/components/common/GradeBadge.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import ClosureDialog from '@/components/common/ClosureDialog.vue'
import { useSiteStore } from '@/stores/siteStore'
import { useProfileStore } from '@/stores/profileStore'
import { useUiStore } from '@/stores/uiStore'
import { useRanking } from '@/hooks/useRanking'
import { closureStateOf, daysBetween, CLOSURE_STATE_META } from '@/types/closure'
import type { ClosureState, SiteClosure } from '@/types/closure'
import { formatDate, todayIso } from '@/utils/format'

const router = useRouter()
const siteStore = useSiteStore()
const profileStore = useProfileStore()
const uiStore = useUiStore()

/**
 * 参考排名：以全体营位（在营 + 当前封营）为全集，
 * 让封营营位仍能看到「若现在恢复，按当前方案能拿多少分」；该结果不用于任何对外统计。
 */
const { referenceScoreOf } = useRanking({
  sites: () => siteStore.openSites,
  referenceSites: () => siteStore.list,
  factorOf: (id: number) => siteStore.latestFactor(id),
  weights: () => profileStore.activeWeights,
  normalize: () => profileStore.activeProfile?.normalize ?? 'minmax',
  thresholds: () => profileStore.activeProfile?.thresholds ?? { gradeA: 78, gradeB: 58 },
  vetoedIds: () => uiStore.vetoedSiteIds
})

const today = todayIso()

interface ActiveRow {
  closure: SiteClosure
  siteId: number
  code: string
  name: string
  campName: string
  state: ClosureState
  dayDelta: number
  factorRounds: number
  vetoCount: number
}

const activeRows = computed<ActiveRow[]>(() =>
  siteStore.closures
    .filter((c) => closureStateOf(c, today) === 'active' || closureStateOf(c, today) === 'overdue')
    .map((c) => {
      const site = siteStore.byId(c.siteId)
      return {
        closure: c,
        siteId: c.siteId,
        code: site?.code ?? '—',
        name: site?.name ?? '营位已删除',
        campName: site?.campName ?? '—',
        state: closureStateOf(c, today),
        dayDelta: daysBetween(today, c.plannedReopenDate),
        factorRounds: siteStore.factorsOf(c.siteId).length,
        vetoCount: uiStore.vetosOf(c.siteId).length
      }
    })
    .sort((a, b) => (a.closure.plannedReopenDate > b.closure.plannedReopenDate ? 1 : -1))
)

interface HistoryRow {
  closure: SiteClosure
  siteId: number
  code: string
  name: string
  campName: string
  state: ClosureState
}

const historyRows = computed<HistoryRow[]>(() =>
  siteStore.closures
    .filter((c) => c.reopened)
    .map((c) => {
      const site = siteStore.byId(c.siteId)
      return {
        closure: c,
        siteId: c.siteId,
        code: site?.code ?? '—',
        name: site?.name ?? '营位已删除',
        campName: site?.campName ?? '—',
        state: closureStateOf(c, today)
      }
    })
    .sort((a, b) => (a.closure.reopenedAt < b.closure.reopenedAt ? 1 : -1))
)

const stats = computed(() => ({
  active: activeRows.value.filter((r) => r.state === 'active').length,
  overdue: activeRows.value.filter((r) => r.state === 'overdue').length,
  history: historyRows.value.length,
  open: siteStore.openSites.length
}))

function referenceOf(siteId: number) {
  return referenceScoreOf(siteId)
}

function openDetail(siteId: number): void {
  void router.push(`/sites/${siteId}`)
}

function stateTagType(state: ClosureState) {
  return CLOSURE_STATE_META[state].tagType
}

/** 历史表格里的短标签：已提前恢复 → 提前恢复 */
function stateShortLabel(state: ClosureState): string {
  return CLOSURE_STATE_META[state].label.replace('已', '')
}

/* ------------------------------ 恢复对话框 ------------------------------ */
const dialogVisible = ref(false)
const dialogSiteId = ref<number | null>(null)
const dialogClosure = ref<SiteClosure | null>(null)

const dialogSite = computed(() =>
  dialogSiteId.value == null ? null : siteStore.byId(dialogSiteId.value)
)

function startReopen(closure: SiteClosure): void {
  dialogSiteId.value = closure.siteId
  dialogClosure.value = closure
  dialogVisible.value = true
}

async function onSubmit(payload: unknown): Promise<void> {
  const p = payload as {
    kind: 'reopen'
    closureId: number
    reopenedAt: string
    operator: string
    note: string
  }
  if (p.kind !== 'reopen') return
  try {
    await siteStore.reopenSite(p.closureId, {
      reopenedAt: p.reopenedAt,
      operator: p.operator,
      note: p.note
    })
    ElMessage.success('营位已恢复，立即按当前方案参与名次表与地图排名')
  } catch (err) {
    ElMessage.error(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head__title">
        <h1>封营管理</h1>
        <p>
          雨季、护坡检修等情况下临时封掉的营位在这里统一查看：封营期间退出名次表与地图推荐，
          不计入最高分与等级统计；原得分、因子与否决记录仍然保留，可随时提前恢复。
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/')">返回名次表</el-button>
        <el-button @click="router.push('/map')">地图视图</el-button>
      </div>
    </div>

    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="封营不等于删除"
      description="封营只把营位暂时移出推荐与统计，全部评估资料原样保留；恢复后立即按当前权重方案参与排名。营位被彻底删除时，其封营资料会一并清除。"
    />

    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-card__label">封营中</div>
        <div class="stat-card__value" :style="{ color: stats.active ? '#d97706' : undefined }">
          {{ stats.active }}
        </div>
        <div class="stat-card__extra">已退出推荐与统计</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">逾期待恢复</div>
        <div class="stat-card__value" :style="{ color: stats.overdue ? '#b91c1c' : undefined }">
          {{ stats.overdue }}
        </div>
        <div class="stat-card__extra">过了计划恢复日期</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">在营营位</div>
        <div class="stat-card__value">{{ stats.open }}</div>
        <div class="stat-card__extra">共 {{ siteStore.total }} 个已登记</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">历史封营</div>
        <div class="stat-card__value">{{ stats.history }}</div>
        <div class="stat-card__extra">已恢复的记录条数</div>
      </div>
    </div>

    <section class="panel">
      <div class="panel__head">
        <h2>当前封营</h2>
        <span class="weight-note">共 {{ activeRows.length }} 个营位暂停推荐</span>
      </div>

      <el-table v-if="activeRows.length" :data="activeRows" size="default" border stripe>
        <el-table-column label="营位" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="openDetail(row.siteId)">
              {{ row.code }} · {{ row.name }}
            </el-link>
            <div class="cell-sub">{{ row.campName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="封营原因" min-width="230">
          <template #default="{ row }">
            <el-tag type="warning" size="small">{{ row.closure.reasonType }}</el-tag>
            <div class="cell-sub reason-text">{{ row.closure.reason }}</div>
          </template>
        </el-table-column>
        <el-table-column label="封营 / 计划恢复" width="196">
          <template #default="{ row }">
            <div>{{ formatDate(row.closure.closedAt) }}</div>
            <div class="cell-sub">至 {{ formatDate(row.closure.plannedReopenDate) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="恢复倒计时" width="120" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.state === 'overdue'" type="danger" size="small">
              已逾期 {{ row.dayDelta }} 天
            </el-tag>
            <el-tag v-else-if="row.dayDelta === 0" type="warning" size="small">今天到期</el-tag>
            <el-tag v-else type="info" size="small">剩 {{ row.dayDelta }} 天</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="参考得分" width="200">
          <template #default="{ row }">
            <GradeBadge
              v-if="referenceOf(row.siteId)"
              :grade="referenceOf(row.siteId)!.grade"
              :score="referenceOf(row.siteId)!.total"
              :vetoed="referenceOf(row.siteId)!.vetoed"
              size="small"
            />
            <span v-else class="muted">—</span>
            <div class="cell-sub">因子 {{ row.factorRounds }} 轮 · 否决 {{ row.vetoCount }} 条</div>
          </template>
        </el-table-column>
        <el-table-column label="操作人" width="96">
          <template #default="{ row }">{{ row.closure.operator }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="success" @click="startReopen(row.closure)">
              {{ row.state === 'overdue' ? '补恢复' : '提前恢复' }}
            </el-button>
            <el-button size="small" text type="primary" @click="openDetail(row.siteId)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <EmptyState
        v-else
        title="当前没有封营中的营位"
        description="需要临时封闭营位时，进入营位详情点击「封营」，填写原因与计划恢复日期即可；封营期间资料保留、退出推荐。"
        action-text="去名次表看看"
        @action="router.push('/')"
      />
    </section>

    <section class="panel">
      <div class="panel__head">
        <h2>封营历史</h2>
        <span class="weight-note">共 {{ historyRows.length }} 条已恢复记录</span>
      </div>
      <el-table v-if="historyRows.length" :data="historyRows" size="small" border>
        <el-table-column label="营位" min-width="190">
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="openDetail(row.siteId)">
              {{ row.code }} · {{ row.name }}
            </el-link>
            <div class="cell-sub">{{ row.campName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="原因" min-width="200">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.closure.reasonType }}</el-tag>
            <div class="cell-sub reason-text">{{ row.closure.reason }}</div>
          </template>
        </el-table-column>
        <el-table-column label="封营日期" width="112">
          <template #default="{ row }">{{ formatDate(row.closure.closedAt) }}</template>
        </el-table-column>
        <el-table-column label="计划恢复" width="112">
          <template #default="{ row }">{{ formatDate(row.closure.plannedReopenDate) }}</template>
        </el-table-column>
        <el-table-column label="实际恢复" width="112">
          <template #default="{ row }">{{ formatDate(row.closure.reopenedAt) }}</template>
        </el-table-column>
        <el-table-column label="恢复情况" width="116" align="center">
          <template #default="{ row }">
            <el-tag :type="stateTagType(row.state as ClosureState)" size="small">
              {{ stateShortLabel(row.state as ClosureState) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="恢复人" width="96">
          <template #default="{ row }">{{ row.closure.reopenOperator || '—' }}</template>
        </el-table-column>
        <el-table-column label="恢复备注" min-width="200">
          <template #default="{ row }">
            {{ row.closure.reopenNote || '—' }}
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="panel__hint">暂无已恢复的封营记录。</p>
    </section>

    <ClosureDialog
      v-model="dialogVisible"
      mode="reopen"
      :site="dialogSite"
      :closure="dialogClosure"
      @submit="onSubmit"
    />
  </div>
</template>

<style scoped>
.cell-sub {
  font-size: 11px;
  color: var(--gb-muted);
}
.reason-text {
  margin-top: 2px;
  line-height: 1.5;
}
.muted {
  color: var(--gb-muted);
}
</style>
