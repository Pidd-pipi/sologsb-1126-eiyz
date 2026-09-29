<script setup lang="ts">
/**
 * `/closures` 封营台账 —— 封营营位的单独入口。
 *
 * 封营期间的营位不进名次表、地图推荐与最高分 / 等级统计，
 * 但本页仍可查看其按当前权重方案计算的留存得分、最新因子与否决记录，
 * 并支持在现场条件具备时提前恢复开放；恢复后立即重新参与排名。
 * 已恢复的封营记录归档在下方台账中可追溯。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import GradeBadge from '@/components/common/GradeBadge.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useSiteStore } from '@/stores/siteStore'
import { useProfileStore } from '@/stores/profileStore'
import { useUiStore } from '@/stores/uiStore'
import { useRanking } from '@/hooks/useRanking'
import { isClosureOverdue } from '@/types/closure'
import type { SiteClosure } from '@/types/closure'
import type { Grade } from '@/utils/score'
import { formatDate, todayIso } from '@/utils/format'

const router = useRouter()
const siteStore = useSiteStore()
const profileStore = useProfileStore()
const uiStore = useUiStore()

/** 留存得分：封营营位不排除（excludedIds 传空），按当前方案算出仅供本页查看的分数 */
const { scoreOf } = useRanking({
  sites: () => siteStore.list,
  factorOf: (id: number) => siteStore.latestFactor(id),
  weights: () => profileStore.activeWeights,
  normalize: () => profileStore.activeProfile?.normalize ?? 'minmax',
  thresholds: () => profileStore.activeProfile?.thresholds ?? { gradeA: 78, gradeB: 58 },
  vetoedIds: () => uiStore.vetoedSiteIds,
  excludedIds: () => []
})

const showHistory = ref(true)

interface ActiveRow {
  siteId: number
  code: string
  name: string
  campName: string
  closure: SiteClosure
  overdue: boolean
  score: number
  grade: Grade
  vetoed: boolean
  latestAssessedAt: string
  latestAssessor: string
}

/** 封营中的营位（含逾期未恢复），按计划恢复日期升序 */
const activeRows = computed(() =>
  siteStore.closures
    .filter((c) => !c.reopenAt && typeof c.siteId === 'number')
    .map((closure) => {
      const site = siteStore.byId(closure.siteId)
      const row = scoreOf(closure.siteId)
      const latest = siteStore.latestFactor(closure.siteId)
      return {
        siteId: closure.siteId,
        code: site?.code ?? '—',
        name: site?.name ?? '营位已删除',
        campName: site?.campName ?? '—',
        closure,
        overdue: isClosureOverdue(closure),
        score: row?.total ?? 0,
        grade: row?.grade ?? 'C',
        vetoed: uiStore.isVetoed(closure.siteId),
        latestAssessedAt: latest?.assessedAt ?? '',
        latestAssessor: latest?.assessor ?? ''
      }
    })
    .sort((a, b) => (a.closure.plannedReopenAt > b.closure.plannedReopenAt ? 1 : -1))
)

/** 已恢复的历史封营记录（最新在前） */
const historyRows = computed(() =>
  siteStore.closures
    .filter((c): c is SiteClosure & { reopenAt: string } => !!c.reopenAt)
    .map((c) => ({
      closure: c,
      site: siteStore.byId(c.siteId)
    }))
    .sort((a, b) => (a.closure.reopenAt < b.closure.reopenAt ? 1 : -1))
)

async function reopen(siteId: number): Promise<void> {
  const input = await ElMessageBox.prompt(
    '确认该营位现场已具备开放条件？恢复后立即按当前权重方案参与排名。请填写「恢复说明 — 确认人」。',
    '恢复开放',
    {
      confirmButtonText: '确认恢复',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '如：雨季结束，现场复核无异常 —— 李营',
      inputValue: '',
      inputValidator: (v: string) =>
        v.trim().length > 0 || '请填写恢复说明与确认人，便于台账留痕'
    }
  )
    .then((d) => (d as unknown as { value: string }).value)
    .catch(() => null)
  if (input == null) return /* 用户取消 */
  const m = /\s*[—–-]{1,2}\s*([^\s—–-]+)\s*$/.exec(input.trim())
  const note = m ? input.trim().slice(0, m.index).trim() : input.trim()
  const reopenedBy = m ? m[1] : '未署名'
  try {
    await siteStore.reopenSite(siteId, { reopenAt: todayIso(), note, reopenedBy })
    ElMessage.success('已恢复开放，营位立即重新参与名次表与地图推荐')
  } catch (err) {
    ElMessage.error(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div class="page-head__title">
        <h1>封营台账</h1>
        <p>
          雨季封闭、护坡检修等情况下临时封营的营位在此统一查看：它们不参与当前推荐、最高分与等级统计，
          但留存得分、因子与否决记录仍可核对；现场条件具备后可在此提前恢复，恢复后立即重新参与排名。
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/')">返回名次表</el-button>
        <el-button @click="router.push('/map')">地图视图</el-button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-card">
        <div class="stat-card__label">封营中</div>
        <div class="stat-card__value" :style="{ color: activeRows.length ? '#b45309' : undefined }">
          {{ activeRows.length }}
        </div>
        <div class="stat-card__extra">不含已恢复营位</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">逾期未恢复</div>
        <div class="stat-card__value" :style="{ color: activeRows.filter((r) => r.overdue).length ? '#b91c1c' : undefined }">
          {{ activeRows.filter((r) => r.overdue).length }}
        </div>
        <div class="stat-card__extra">超过计划恢复日期</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">累计封营记录</div>
        <div class="stat-card__value">{{ siteStore.closures.length }}</div>
        <div class="stat-card__extra">含历史已恢复 {{ historyRows.length }} 次</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">当前方案</div>
        <div class="stat-card__value profile-name">{{ profileStore.activeProfile?.name ?? '—' }}</div>
        <div class="stat-card__extra">留存得分按此方案实时计算</div>
      </div>
    </div>

    <section class="panel">
      <div class="panel__head">
        <h2>封营中营位（{{ activeRows.length }}）</h2>
        <span class="weight-note">得分/等级为留存数据，不计入任何统计</span>
      </div>
      <el-table v-if="activeRows.length" :data="activeRows" size="default" border stripe>
        <el-table-column label="状态" width="118">
          <template #default="{ row }">
            <el-tag :type="row.overdue ? 'danger' : 'warning'" size="small">
              {{ row.overdue ? '逾期未恢复' : '封营中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="营位" min-width="210">
          <template #default="{ row }">
            <el-link type="primary" underline="never" @click="router.push(`/sites/${row.siteId}`)">
              {{ row.code }} · {{ row.name }}
            </el-link>
            <div class="cell-sub">{{ row.campName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="封营原因" width="120">
          <template #default="{ row }">
            <el-tag type="warning" effect="plain" size="small">{{ row.closure.reason }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="closure.detail" label="情况说明" min-width="220" show-overflow-tooltip />
        <el-table-column label="封营 / 计划恢复" width="190">
          <template #default="{ row }">
            {{ formatDate(row.closure.closedAt) }}
            <div class="cell-sub">计划 {{ formatDate(row.closure.plannedReopenAt) }} · {{ row.closure.closedBy }}</div>
          </template>
        </el-table-column>
        <el-table-column label="留存等级 / 得分" width="200">
          <template #default="{ row }">
            <GradeBadge :grade="row.grade" :score="row.score" :vetoed="row.vetoed" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="最近因子评估" width="170">
          <template #default="{ row }">
            <template v-if="row.latestAssessedAt">
              {{ formatDate(row.latestAssessedAt) }}
              <div class="cell-sub">{{ row.latestAssessor }}</div>
            </template>
            <span v-else class="muted">暂无评估</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="router.push(`/sites/${row.siteId}`)">
              留存资料
            </el-button>
            <el-button size="small" text type="success" @click="reopen(row.siteId)">提前恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState
        v-else
        title="当前没有封营中的营位"
        description="雨季或护坡检修需要临时封闭营位时，可在营位详情页点击「办理封营」，填写原因与计划恢复日期。"
        action-text="去名次表选择营位"
        @action="router.push('/')"
      />
    </section>

    <section class="panel">
      <div class="panel__head">
        <h2>历史封营记录</h2>
        <el-button size="small" text @click="showHistory = !showHistory">
          {{ showHistory ? '收起' : `展开（${historyRows.length}）` }}
        </el-button>
      </div>
      <el-table v-if="showHistory && historyRows.length" :data="historyRows" size="small" border>
        <el-table-column label="营位" min-width="200">
          <template #default="{ row }">
            <el-link
              v-if="row.site"
              type="primary"
              underline="never"
              @click="router.push(`/sites/${row.closure.siteId}`)"
            >
              {{ row.site.code }} · {{ row.site.name }}
            </el-link>
            <span v-else class="muted">营位已删除（资料随营位一并清除）</span>
          </template>
        </el-table-column>
        <el-table-column prop="closure.reason" label="原因" width="120" />
        <el-table-column prop="closure.detail" label="封营说明" min-width="200" show-overflow-tooltip />
        <el-table-column label="封营日期" width="112">
          <template #default="{ row }">{{ formatDate(row.closure.closedAt) }}</template>
        </el-table-column>
        <el-table-column label="计划恢复" width="112">
          <template #default="{ row }">{{ formatDate(row.closure.plannedReopenAt) }}</template>
        </el-table-column>
        <el-table-column label="实际恢复" width="112">
          <template #default="{ row }">{{ formatDate(row.closure.reopenAt) }}</template>
        </el-table-column>
        <el-table-column label="恢复说明 / 确认人" min-width="220">
          <template #default="{ row }">
            {{ row.closure.reopenNote ?? '—' }}
            <div class="cell-sub">{{ row.closure.reopenedBy ?? '—' }}</div>
          </template>
        </el-table-column>
      </el-table>
      <p v-else-if="!historyRows.length" class="panel__hint">暂无已恢复的封营记录。</p>
    </section>
  </div>
</template>

<style scoped>
.cell-sub {
  font-size: 11px;
  color: var(--gb-muted);
}
.profile-name {
  font-size: 15px;
}
.muted {
  color: var(--gb-muted);
}
</style>
