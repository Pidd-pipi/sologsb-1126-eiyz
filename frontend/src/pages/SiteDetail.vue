<script setup lang="ts">
/**
 * `/sites/:id` 营位详情 —— 上部地图定位与基本信息，中部因子打分表，下部否决记录与多轮复核。
 * 雨季/检修时可在此办理封营（原因 + 计划恢复日期）或提前恢复；
 * 封营期间名次表/地图不把它计入推荐，但本页仍可查看留存的得分、因子与否决记录。
 * 消费五个模型；复用 <MapPanel>、<FactorScoreBar>、<GradeBadge>。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import MapPanel from '@/components/common/MapPanel.vue'
import FactorScoreBar from '@/components/common/FactorScoreBar.vue'
import GradeBadge from '@/components/common/GradeBadge.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { useSiteStore } from '@/stores/siteStore'
import { useProfileStore } from '@/stores/profileStore'
import { useUiStore } from '@/stores/uiStore'
import { useRanking } from '@/hooks/useRanking'
import { FACTOR_META, NORMALIZE_LABELS } from '@/types/score'
import { ASPECT_TYPES, SURFACE_TYPES, ACCESS_MODES } from '@/types/campsite'
import type { AspectType, AccessMode, SurfaceType } from '@/types/campsite'
import type { Grade } from '@/utils/score'
import type { RockfallRisk, WindDir, WindForce } from '@/types/factor'
import { ROCKFALL_RISKS, WIND_DIRS, WIND_FORCES } from '@/types/factor'
import { VETO_TYPES, VETO_HINTS } from '@/types/veto'
import type { VetoType } from '@/types/veto'
import { CLOSURE_REASONS, CLOSURE_REASON_HINTS, isClosureOverdue } from '@/types/closure'
import type { ClosureReason, SiteClosure } from '@/types/closure'
import { formatDate, formatDateTime, todayIso } from '@/utils/format'
import { formatLat, formatLng } from '@/utils/geo'

const route = useRoute()
const router = useRouter()
const siteStore = useSiteStore()
const profileStore = useProfileStore()
const uiStore = useUiStore()

const siteId = computed(() => Number(route.params.id))
const site = computed(() => siteStore.byId(siteId.value))

// 详情页是封营营位的「单独入口」：留存得分按当前方案照常计算，
// 但不把封营营位排除（excludedIds 传空），名次仅作封营前的参考展示。
const { scoreOf } = useRanking({
  sites: () => siteStore.list,
  factorOf: (id: number) => siteStore.latestFactor(id),
  weights: () => profileStore.activeWeights,
  normalize: () => profileStore.activeProfile?.normalize ?? 'minmax',
  thresholds: () => profileStore.activeProfile?.thresholds ?? { gradeA: 78, gradeB: 58 },
  vetoedIds: () => uiStore.vetoedSiteIds,
  excludedIds: () => []
})

const scoreRow = computed(() => scoreOf(siteId.value))

/** 供 MapPanel 与地图标记回调使用（避免在模板里写带类型标注的箭头函数） */
function gradeOfSite(id: number): Grade {
  return scoreOf(id)?.grade ?? 'C'
}

function isSiteClosed(id: number): boolean {
  return siteStore.isClosed(id)
}

function openSite(id: number): void {
  void router.push(`/sites/${id}`)
}
const grade = computed(() => scoreRow.value?.grade ?? 'C')
const factorHistory = computed(() => siteStore.factorsOf(siteId.value))
const vetoList = computed(() => uiStore.vetosOf(siteId.value))

/* ------------------------------- 封营 / 恢复 ------------------------------- */
const activeClosure = computed<SiteClosure | null>(() => siteStore.activeClosureOf(siteId.value))
const closureHistory = computed<SiteClosure[]>(() => siteStore.closuresOf(siteId.value))
const closureOverdue = computed(() =>
  activeClosure.value ? isClosureOverdue(activeClosure.value) : false
)

const closeDialogVisible = ref(false)
const closeForm = reactive({
  reason: '雨季封闭' as ClosureReason,
  detail: '',
  plannedReopenAt: todayIso(),
  closedBy: '',
  closedAt: todayIso()
})
const closeSubmitting = ref(false)

function openCloseDialog(): void {
  closeForm.reason = '雨季封闭'
  closeForm.detail = ''
  closeForm.plannedReopenAt = todayIso()
  closeForm.closedBy = ''
  closeForm.closedAt = todayIso()
  closeDialogVisible.value = true
}

async function submitClose(): Promise<void> {
  if (!site.value) return
  if (!closeForm.plannedReopenAt) {
    ElMessage.warning('请选择计划恢复日期')
    return
  }
  if (closeForm.plannedReopenAt < closeForm.closedAt) {
    ElMessage.warning('计划恢复日期不能早于封营日期')
    return
  }
  if (!closeForm.detail.trim()) {
    ElMessage.warning('请填写封营原因说明（现场情况与处置安排）')
    return
  }
  closeSubmitting.value = true
  try {
    await siteStore.closeSite(siteId.value, {
      reason: closeForm.reason,
      detail: closeForm.detail.trim(),
      plannedReopenAt: closeForm.plannedReopenAt,
      closedBy: closeForm.closedBy.trim() || '未署名',
      closedAt: closeForm.closedAt || todayIso()
    })
    closeDialogVisible.value = false
    ElMessage.success('已封营：名次表与地图不再推荐该营位，恢复后立即重新参与排名')
  } catch (err) {
    ElMessage.error(`封营失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    closeSubmitting.value = false
  }
}

const reopenSubmitting = ref(false)

async function reopenSite(): Promise<void> {
  if (!site.value || !activeClosure.value) return
  const overdue = activeClosure.value.plannedReopenAt < todayIso()
  const input = await ElMessageBox.prompt(
    overdue
      ? '该营位已超过计划恢复日期。确认现场已具备开放条件？请填写「恢复说明 — 确认人」。'
      : '现场已具备开放条件即可提前恢复，恢复后立即按当前权重方案参与排名。请填写「恢复说明 — 确认人」。',
    overdue ? '恢复开放（已逾期）' : '提前恢复开放',
    {
      confirmButtonText: '确认恢复',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '如：护坡施工提前完成，已复核无落石 —— 李营',
      inputValue: '',
      inputValidator: (v: string) =>
        v.trim().length > 0 || '请填写恢复说明与确认人，便于台账留痕'
    }
  )
    .then((d) => (d as unknown as { value: string }).value)
    .catch(() => null)
  if (input == null) return /* 用户取消 */
  // 支持「说明 —— 确认人」的简易拆分：取最后一个破折号后的内容作为署名
  const m = /\s*[—–-]{1,2}\s*([^\s—–-]+)\s*$/.exec(input.trim())
  const note = m ? input.trim().slice(0, m.index).trim() : input.trim()
  const reopenedBy = m ? m[1] : '未署名'
  reopenSubmitting.value = true
  try {
    await siteStore.reopenSite(siteId.value, { reopenAt: todayIso(), note, reopenedBy })
    ElMessage.success('已恢复开放，营位立即按当前方案参与排名')
  } catch (err) {
    ElMessage.error(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    reopenSubmitting.value = false
  }
}

/* --------------------------- 多轮因子复核录入 --------------------------- */
const showFactorForm = ref(false)
const factorForm = reactive({
  waterDistance: 60,
  windDir: '东南' as WindDir,
  windForce: 1 as WindForce,
  signalBars: 4,
  sunHours: 5,
  rockfallRisk: '无' as RockfallRisk,
  shade: 35,
  distanceToCar: 40,
  distanceToTrail: 50,
  assessor: '',
  assessedAt: todayIso()
})

function prefillFactor(): void {
  const latest = siteStore.latestFactor(siteId.value)
  if (latest) {
    factorForm.waterDistance = latest.waterDistance
    factorForm.windDir = latest.windDir
    factorForm.windForce = latest.windForce
    factorForm.signalBars = latest.signalBars
    factorForm.sunHours = latest.sunHours
    factorForm.rockfallRisk = latest.rockfallRisk
    factorForm.shade = latest.shade
    factorForm.distanceToCar = latest.distanceToCar
    factorForm.distanceToTrail = latest.distanceToTrail
    factorForm.assessor = latest.assessor
  }
  factorForm.assessedAt = todayIso()
}

async function submitFactor(): Promise<void> {
  if (!site.value) return
  try {
    await siteStore.addFactor({
      siteId: siteId.value,
      waterDistance: Number(factorForm.waterDistance),
      windDir: factorForm.windDir,
      windForce: factorForm.windForce,
      signalBars: Number(factorForm.signalBars),
      sunHours: Number(factorForm.sunHours),
      rockfallRisk: factorForm.rockfallRisk,
      shade: Number(factorForm.shade),
      distanceToCar: Number(factorForm.distanceToCar),
      distanceToTrail: Number(factorForm.distanceToTrail),
      assessor: factorForm.assessor.trim() || '未署名',
      assessedAt: factorForm.assessedAt || todayIso(),
      createdAt: '',
      updatedAt: ''
    })
    showFactorForm.value = false
    ElMessage.success('已追加一轮因子评估，名次与等级同步刷新')
  } catch (err) {
    ElMessage.error(`追加失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function removeFactor(id: number | undefined): Promise<void> {
  if (typeof id !== 'number') return
  try {
    await ElMessageBox.confirm('确认删除这一轮因子评估？删除后名次会立即重算。', '提示', {
      type: 'warning'
    })
    await siteStore.removeFactor(id)
    ElMessage.success('已删除该轮评估')
  } catch {
    /* 用户取消 */
  }
}

/* ------------------------------ 否决记录 ------------------------------ */
const vetoForm = reactive({
  type: '山洪沟' as VetoType,
  description: '',
  judge: '',
  judgedAt: todayIso()
})

async function addVetoHere(): Promise<void> {
  if (!site.value) return
  if (!vetoForm.description.trim()) {
    ElMessage.warning('请填写否决说明')
    return
  }
  await uiStore.addVeto({
    siteId: siteId.value,
    type: vetoForm.type,
    description: vetoForm.description.trim(),
    judge: vetoForm.judge.trim() || '未署名',
    judgedAt: vetoForm.judgedAt || todayIso(),
    createdAt: '',
    updatedAt: ''
  })
  vetoForm.description = ''
  ElMessage.success('已登记否决项，该营位在名次表与地图上标红且禁止评 A')
}

async function removeVeto(id: number | undefined): Promise<void> {
  if (typeof id !== 'number') return
  await uiStore.removeVeto(id)
  ElMessage.success('已解除该否决项')
}

/* ------------------------------ 基本信息编辑 ------------------------------ */
const editing = ref(false)
const editForm = reactive({
  name: '',
  campName: '',
  elevation: 0,
  slope: 0,
  aspect: '东南' as AspectType,
  surface: '草地' as SurfaceType,
  tentCapacity: 1,
  flatness: 80,
  access: '车行' as AccessMode,
  note: ''
})

function startEdit(): void {
  const s = site.value
  if (!s) return
  editForm.name = s.name
  editForm.campName = s.campName
  editForm.elevation = s.elevation
  editForm.slope = s.slope
  editForm.aspect = s.aspect
  editForm.surface = s.surface
  editForm.tentCapacity = s.tentCapacity
  editForm.flatness = s.flatness
  editForm.access = s.access
  editForm.note = s.note
  editing.value = true
}

async function saveEdit(): Promise<void> {
  if (!site.value) return
  await siteStore.updateSite(siteId.value, {
    name: editForm.name.trim() || site.value.name,
    campName: editForm.campName.trim() || site.value.campName,
    elevation: Number(editForm.elevation),
    slope: Number(editForm.slope),
    aspect: editForm.aspect,
    surface: editForm.surface,
    tentCapacity: Number(editForm.tentCapacity),
    flatness: Number(editForm.flatness),
    access: editForm.access,
    note: editForm.note.trim()
  })
  editing.value = false
  ElMessage.success('营位基础信息已更新')
}

/** 因子明细行，附带原始值与权重信息 */
const factorRows = computed(() => {
  const row = scoreRow.value
  if (!row) return []
  return row.rows.map((r) => ({ ...r, higherIsBetter: metaOf(r.key)?.higherIsBetter ?? true }))
})

function metaOf(key: string) {
  return FACTOR_META.find((m) => m.key === key)
}

watch(
  () => route.params.id,
  () => {
    showFactorForm.value = false
    editing.value = false
    prefillFactor()
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="site" class="page">
    <div class="page-head">
      <div class="page-head__title">
        <h1>{{ site.code }} · {{ site.name }}</h1>
        <p>
          {{ site.campName }} · {{ site.surface }} · 容 {{ site.tentCapacity }} 帐 ·
          {{ site.access }} · 海拔 {{ site.elevation }} m
        </p>
      </div>
      <div class="page-actions">
        <el-button @click="router.push('/')">返回名次表</el-button>
        <el-button @click="router.push('/map')">地图视图</el-button>
        <el-button type="primary" @click="startEdit">编辑基础信息</el-button>
        <el-button
          v-if="activeClosure"
          type="success"
          :loading="reopenSubmitting"
          @click="reopenSite"
        >
          提前恢复开放
        </el-button>
        <el-button v-else type="warning" plain @click="openCloseDialog">办理封营</el-button>
      </div>
    </div>

    <el-alert
      v-if="activeClosure"
      :type="closureOverdue ? 'error' : 'warning'"
      show-icon
      :closable="false"
      class="closure-alert"
    >
      <template #title>
        <span>
          该营位封营中（{{ activeClosure.reason }}），不计入当前推荐、最高分与等级统计；
          计划恢复日期 {{ formatDate(activeClosure.plannedReopenAt) }}
          <el-tag v-if="closureOverdue" type="danger" size="small" class="ml6">
            已逾期，请确认现场后恢复
          </el-tag>
        </span>
      </template>
      <template #default>
        <div class="closure-alert__body">
          <span>{{ activeClosure.detail }}</span>
          <span class="weight-note">
            封营 {{ formatDate(activeClosure.closedAt) }} · {{ activeClosure.closedBy }} ｜
            下方得分、因子与否决为留存数据，仅供查看
          </span>
        </div>
      </template>
    </el-alert>

    <el-alert
      v-if="vetoList.length"
      type="error"
      show-icon
      :closable="false"
      title="该营位命中风险否决项，综合等级已被压到 C 级（禁止评 A）"
      :description="vetoList.map((v) => `${v.type}：${v.description}`).join(' ｜ ')"
    />

    <MapPanel
      :sites="siteStore.list"
      :selected-id="siteId"
      :grade-of="gradeOfSite"
      :closed-of="isSiteClosed"
      height="360px"
      :title="`营位定位 · ${site.code}`"
      @select="openSite"
    />

    <div class="stat-row">
      <div class="stat-card" :class="{ 'stat-card--muted': !!activeClosure }">
        <div class="stat-card__label">{{ activeClosure ? '留存综合得分' : '综合得分' }}</div>
        <div class="stat-card__value">{{ scoreRow?.total ?? '—' }}</div>
        <div class="stat-card__extra">方案 {{ profileStore.activeProfile?.name ?? '—' }}</div>
      </div>
      <div class="stat-card" :class="{ 'stat-card--muted': !!activeClosure }">
        <div class="stat-card__label">{{ activeClosure ? '留存推荐等级' : '推荐等级' }}</div>
        <div class="stat-card__value">
          <GradeBadge :grade="grade" size="large" :vetoed="vetoList.length > 0" />
        </div>
        <div class="stat-card__extra">
          {{ activeClosure ? '封营中，不参与名次' : `名次第 ${scoreRow?.rank ?? '—'} 位` }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">坐标</div>
        <div class="stat-card__value coord">{{ formatLng(site.lng) }}</div>
        <div class="stat-card__extra">{{ formatLat(site.lat) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">评估轮次</div>
        <div class="stat-card__value">{{ factorHistory.length }}</div>
        <div class="stat-card__extra">
          否决项 {{ vetoList.length }} 条 · 封营 {{ closureHistory.length }} 次
        </div>
      </div>
    </div>

    <section v-if="editing" class="panel">
      <div class="panel__head">
        <h2>编辑基础信息</h2>
      </div>
      <el-form label-width="112px" @submit.prevent>
        <div class="form-grid">
          <el-form-item label="营位名称">
            <el-input id="edit-name" v-model="editForm.name" />
          </el-form-item>
          <el-form-item label="所属营地">
            <el-input id="edit-camp" v-model="editForm.campName" />
          </el-form-item>
          <el-form-item label="海拔（m）">
            <el-input-number
              id="edit-elevation"
              v-model="editForm.elevation"
              :min="0"
              :max="6000"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="坡度（°）">
            <el-input-number
              id="edit-slope"
              v-model="editForm.slope"
              :min="0"
              :max="45"
              :step="0.1"
              :precision="1"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="坡向">
            <el-select id="edit-aspect" v-model="editForm.aspect" style="width: 100%">
              <el-option v-for="a in ASPECT_TYPES" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
          <el-form-item label="地表类型">
            <el-select id="edit-surface" v-model="editForm.surface" style="width: 100%">
              <el-option v-for="s in SURFACE_TYPES" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="可容帐篷数">
            <el-input-number
              id="edit-capacity"
              v-model="editForm.tentCapacity"
              :min="1"
              :max="60"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="平整度评分">
            <el-input-number
              id="edit-flatness"
              v-model="editForm.flatness"
              :min="0"
              :max="100"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="进出方式">
            <el-radio-group v-model="editForm.access">
              <el-radio v-for="a in ACCESS_MODES" :key="a" :value="a">{{ a }}</el-radio>
            </el-radio-group>
          </el-form-item>
        </div>
        <el-form-item label="备注">
          <el-input v-model="editForm.note" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveEdit">保存</el-button>
          <el-button @click="editing = false">取消</el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="panel">
      <div class="panel__head">
        <h2>因子打分表</h2>
        <span class="weight-note">
          归一方式：{{ profileStore.activeProfile ? NORMALIZE_LABELS[profileStore.activeProfile.normalize] : '—' }}
          · 等级阈值 A ≥ {{ profileStore.activeProfile?.thresholds.gradeA ?? 78 }} / B ≥
          {{ profileStore.activeProfile?.thresholds.gradeB ?? 58 }}
        </span>
      </div>
      <div class="factor-grid">
        <FactorScoreBar
          v-for="row in factorRows"
          :key="row.key"
          :factor-key="row.key"
          :label="row.label"
          :raw="row.raw"
          :normalized="row.normalized"
          :weight="row.weight"
          :weight-ratio="row.weightRatio"
          :higher-is-better="row.higherIsBetter"
          :contribution="row.contribution"
        />
      </div>
      <p class="panel__hint">
        当前名次所用因子来自最新一轮评估（{{ siteStore.latestFactor(siteId)?.assessedAt ?? '暂无' }}，
        评估人 {{ siteStore.latestFactor(siteId)?.assessor ?? '—' }}）。
      </p>
    </section>

    <section class="panel">
      <div class="panel__head">
        <h2>多轮因子复核</h2>
        <el-button
          size="small"
          type="primary"
          plain
          @click="
            () => {
              prefillFactor()
              showFactorForm = !showFactorForm
            }
          "
        >
          {{ showFactorForm ? '收起录入' : '追加一轮评估' }}
        </el-button>
      </div>

      <el-form v-if="showFactorForm" label-width="112px" class="review-form" @submit.prevent>
        <div class="form-grid">
          <el-form-item label="水源距离（m）">
            <el-input-number
              id="review-water"
              v-model="factorForm.waterDistance"
              :min="0"
              :max="5000"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="风向">
            <el-select id="review-windDir" v-model="factorForm.windDir" style="width: 100%">
              <el-option v-for="d in WIND_DIRS" :key="d" :label="d" :value="d" />
            </el-select>
          </el-form-item>
          <el-form-item label="风力等级">
            <el-select id="review-windForce" v-model="factorForm.windForce" style="width: 100%">
              <el-option v-for="f in WIND_FORCES" :key="f" :label="`${f} 级`" :value="f" />
            </el-select>
          </el-form-item>
          <el-form-item label="信号强度（格）">
            <el-input-number
              id="review-signal"
              v-model="factorForm.signalBars"
              :min="0"
              :max="5"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="日照时长（h）">
            <el-input-number
              id="review-sun"
              v-model="factorForm.sunHours"
              :min="0"
              :max="14"
              :step="0.1"
              :precision="1"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="落石落枝风险">
            <el-select id="review-rockfall" v-model="factorForm.rockfallRisk" style="width: 100%">
              <el-option v-for="r in ROCKFALL_RISKS" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
          <el-form-item label="植被遮蔽度">
            <el-input-number
              id="review-shade"
              v-model="factorForm.shade"
              :min="0"
              :max="100"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="离车距离（m）">
            <el-input-number
              id="review-car"
              v-model="factorForm.distanceToCar"
              :min="0"
              :max="5000"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="离步道（m）">
            <el-input-number
              id="review-trail"
              v-model="factorForm.distanceToTrail"
              :min="0"
              :max="5000"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="评估人">
            <el-input id="review-assessor" v-model="factorForm.assessor" />
          </el-form-item>
          <el-form-item label="评估日期">
            <el-date-picker
              id="review-date"
              v-model="factorForm.assessedAt"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
        </div>
        <el-form-item>
          <el-button type="primary" @click="submitFactor">提交本轮评估</el-button>
        </el-form-item>
      </el-form>

      <el-table v-if="factorHistory.length" :data="factorHistory" size="small" border>
        <el-table-column label="序号" width="64" type="index" />
        <el-table-column prop="assessedAt" label="评估日期" width="118">
          <template #default="{ row }">{{ formatDate(row.assessedAt) }}</template>
        </el-table-column>
        <el-table-column prop="assessor" label="评估人" width="110" />
        <el-table-column label="水源" width="90">
          <template #default="{ row }">{{ row.waterDistance }} m</template>
        </el-table-column>
        <el-table-column label="风向 / 风力" width="130">
          <template #default="{ row }">{{ row.windDir }} {{ row.windForce }} 级</template>
        </el-table-column>
        <el-table-column label="信号" width="80">
          <template #default="{ row }">{{ row.signalBars }} 格</template>
        </el-table-column>
        <el-table-column label="日照" width="86">
          <template #default="{ row }">{{ row.sunHours }} h</template>
        </el-table-column>
        <el-table-column label="落石落枝" width="100">
          <template #default="{ row }">{{ row.rockfallRisk }}</template>
        </el-table-column>
        <el-table-column label="遮蔽度" width="88">
          <template #default="{ row }">{{ row.shade }}</template>
        </el-table-column>
        <el-table-column label="离车 / 离步道" width="140">
          <template #default="{ row }">{{ row.distanceToCar }} / {{ row.distanceToTrail }} m</template>
        </el-table-column>
        <el-table-column label="录入时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="danger" @click="removeFactor(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="panel__hint">暂无因子评估记录，点击「追加一轮评估」开始录入。</p>
    </section>

    <section class="panel">
      <div class="panel__head">
        <h2>风险否决记录</h2>
        <span class="weight-note">命中任一条即整行标红并禁止评 A</span>
      </div>

      <el-table v-if="vetoList.length" :data="vetoList" size="small" border>
        <el-table-column prop="type" label="否决类型" width="130">
          <template #default="{ row }">
            <el-tag type="danger" size="small">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="260" />
        <el-table-column prop="judge" label="判定人" width="110" />
        <el-table-column label="判定日期" width="120">
          <template #default="{ row }">{{ formatDate(row.judgedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="danger" @click="removeVeto(row.id)">解除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p v-else class="panel__hint">该营位暂无否决记录，可在下方直接登记。</p>

      <el-divider content-position="left">登记新的否决项</el-divider>
      <el-form label-width="100px" @submit.prevent>
        <div class="form-grid">
          <el-form-item label="否决类型">
            <el-select id="veto-type" v-model="vetoForm.type" style="width: 100%">
              <el-option v-for="t in VETO_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="判定人">
            <el-input id="veto-judge" v-model="vetoForm.judge" placeholder="如 周勘" />
          </el-form-item>
          <el-form-item label="判定日期">
            <el-date-picker
              id="veto-date"
              v-model="vetoForm.judgedAt"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
        </div>
        <el-form-item label="说明">
          <el-input
            id="veto-desc"
            v-model="vetoForm.description"
            type="textarea"
            :rows="2"
            :placeholder="VETO_HINTS[vetoForm.type]"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="danger" plain @click="addVetoHere">登记否决项</el-button>
        </el-form-item>
      </el-form>
    </section>

    <section class="panel">
      <div class="panel__head">
        <h2>封营记录</h2>
        <div>
          <el-tag v-if="activeClosure" :type="closureOverdue ? 'danger' : 'warning'" size="small" class="mr6">
            {{ closureOverdue ? '封营逾期未恢复' : '封营中' }}
          </el-tag>
          <el-button
            v-if="activeClosure"
            size="small"
            type="success"
            plain
            :loading="reopenSubmitting"
            @click="reopenSite"
          >
            提前恢复开放
          </el-button>
          <el-button v-else size="small" type="warning" plain @click="openCloseDialog">
            办理封营
          </el-button>
        </div>
      </div>
      <p class="panel__hint">
        封营期间营位暂不进入名次表、地图推荐与最高分 / 等级统计，但本页保留全部得分、因子与否决数据；
        恢复开放后立即按当前权重方案参与排名。
      </p>
      <el-table v-if="closureHistory.length" :data="closureHistory" size="small" border>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="!row.reopenAt" :type="isClosureOverdue(row) ? 'danger' : 'warning'" size="small">
              {{ isClosureOverdue(row) ? '逾期未恢复' : '封营中' }}
            </el-tag>
            <el-tag v-else type="success" size="small">已恢复</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" width="120" />
        <el-table-column prop="detail" label="说明" min-width="240" />
        <el-table-column label="封营日期" width="112">
          <template #default="{ row }">{{ formatDate(row.closedAt) }}</template>
        </el-table-column>
        <el-table-column label="计划恢复" width="112">
          <template #default="{ row }">{{ formatDate(row.plannedReopenAt) }}</template>
        </el-table-column>
        <el-table-column label="实际恢复" width="112">
          <template #default="{ row }">{{ row.reopenAt ? formatDate(row.reopenAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="操作人" min-width="150">
          <template #default="{ row }">
            {{ row.closedBy }}<template v-if="row.reopenedBy"> → {{ row.reopenedBy }}</template>
          </template>
        </el-table-column>
        <el-table-column label="恢复说明" min-width="180">
          <template #default="{ row }">{{ row.reopenNote ?? '—' }}</template>
        </el-table-column>
      </el-table>
      <p v-else class="panel__hint">该营位暂无封营记录。雨季或护坡检修时可办理临时封营。</p>
    </section>

    <el-dialog v-model="closeDialogVisible" title="办理封营" width="540px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="封营后该营位立即退出推荐"
        description="名次表、地图与等级统计不再计入该营位；历史得分、因子与否决记录全部保留，可从详情页或封营台账查看，恢复后立即重新参与排名。"
        class="dialog-alert"
      />
      <el-form label-width="112px" @submit.prevent>
        <el-form-item label="封营原因" required>
          <el-select v-model="closeForm.reason" style="width: 100%">
            <el-option v-for="r in CLOSURE_REASONS" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="封营日期" required>
          <el-date-picker
            v-model="closeForm.closedAt"
            type="date"
            value-format="YYYY-MM-DD"
            :disabled-date="(d: Date) => d.getTime() > Date.now()"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="计划恢复日期" required>
          <el-date-picker
            v-model="closeForm.plannedReopenAt"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="操作人">
          <el-input v-model="closeForm.closedBy" placeholder="如 李营" />
        </el-form-item>
        <el-form-item label="情况说明" required>
          <el-input
            v-model="closeForm.detail"
            type="textarea"
            :rows="3"
            :maxlength="200"
            show-word-limit
            :placeholder="CLOSURE_REASON_HINTS[closeForm.reason]"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeDialogVisible = false">取消</el-button>
        <el-button type="warning" :loading="closeSubmitting" @click="submitClose">
          确认封营
        </el-button>
      </template>
    </el-dialog>
  </div>

  <div v-else class="page">
    <section class="panel">
      <EmptyState
        title="没有找到这个营位"
        description="该营位可能已被删除，或链接中的编号不正确。返回名次表查看全部候选营位，或直接新增一个。"
        action-text="新增营位"
        @action="router.push('/sites/new')"
      />
    </section>
  </div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0 18px;
}
.factor-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 8px;
}
.coord {
  font-size: 15px;
}
.review-form {
  margin-bottom: 12px;
}
.closure-alert {
  margin-bottom: 12px;
}
.closure-alert__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-card--muted {
  opacity: 0.72;
}
.stat-card--muted .stat-card__value {
  color: var(--gb-muted);
}
.dialog-alert {
  margin-bottom: 14px;
}
.ml6 {
  margin-left: 6px;
}
.mr6 {
  margin-right: 6px;
}
</style>
