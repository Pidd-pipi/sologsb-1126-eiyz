<script setup lang="ts">
/**
 * ClosureDialog —— 封营 / 恢复营位二合一对话框。
 *
 * - mode="close"：填写原因分类、原因说明（必填）、操作人与计划恢复日期（必填）；
 * - mode="reopen"：可在计划恢复日期之前提前恢复，也可逾期后补恢复，记录实际恢复日期、操作人与备注。
 * 提交内容通过 @submit 抛出，由父组件调用 siteStore.closeSite / reopenSite 落库。
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { Campsite } from '@/types/campsite'
import type { SiteClosure, ClosureReasonType } from '@/types/closure'
import { CLOSURE_REASON_TYPES, CLOSURE_REASON_HINTS, daysBetween } from '@/types/closure'
import { formatDate, todayIso } from '@/utils/format'

const props = defineProps<{
  modelValue: boolean
  mode: 'close' | 'reopen'
  site: Campsite | null
  /** reopen 模式下当前生效的封营记录 */
  closure?: SiteClosure | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (
    e: 'submit',
    payload:
      | {
          kind: 'close'
          siteId: number
          reasonType: ClosureReasonType
          reason: string
          operator: string
          closedAt: string
          plannedReopenDate: string
        }
      | {
          kind: 'reopen'
          closureId: number
          reopenedAt: string
          operator: string
          note: string
        }
  ): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

function plusDays(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const closeForm = reactive({
  reasonType: '雨季封营' as ClosureReasonType,
  reason: '',
  operator: '',
  closedAt: todayIso(),
  plannedReopenDate: plusDays(todayIso(), 7)
})

const reopenForm = reactive({
  reopenedAt: todayIso(),
  operator: '',
  note: ''
})

const submitting = ref(false)

/** 恢复日期相对计划日期：负数=提前、0=按期、正数=逾期补恢复 */
const reopenOffset = computed(() => {
  if (props.mode !== 'reopen' || !props.closure) return 0
  return daysBetween(props.closure.plannedReopenDate, reopenForm.reopenedAt)
})

const reopenHint = computed(() => {
  if (!props.closure) return ''
  const n = reopenOffset.value
  if (n < 0) return `将提前 ${-n} 天恢复，恢复后立即按当前方案参与排名。`
  if (n === 0) return '按计划恢复日期恢复，恢复后立即参与排名。'
  return `已超过计划恢复日期 ${n} 天，本次为补恢复。`
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    submitting.value = false
    if (props.mode === 'close') {
      closeForm.reasonType = '雨季封营'
      closeForm.reason = ''
      closeForm.operator = ''
      closeForm.closedAt = todayIso()
      closeForm.plannedReopenDate = plusDays(todayIso(), 7)
    } else {
      reopenForm.reopenedAt = todayIso()
      reopenForm.operator = ''
      reopenForm.note = ''
    }
  }
)

async function handleSubmit(): Promise<void> {
  if (!props.site || typeof props.site.id !== 'number') return
  if (props.mode === 'close') {
    if (!closeForm.reason.trim()) {
      ElMessage.warning('请填写封营原因')
      return
    }
    if (!closeForm.closedAt) {
      ElMessage.warning('请选择封营日期')
      return
    }
    if (!closeForm.plannedReopenDate) {
      ElMessage.warning('请选择计划恢复日期')
      return
    }
    if (closeForm.plannedReopenDate < closeForm.closedAt) {
      ElMessage.warning('计划恢复日期不能早于封营日期')
      return
    }
    submitting.value = true
    emit('submit', {
      kind: 'close',
      siteId: props.site.id,
      reasonType: closeForm.reasonType,
      reason: closeForm.reason.trim(),
      operator: closeForm.operator.trim() || '未署名',
      closedAt: closeForm.closedAt,
      plannedReopenDate: closeForm.plannedReopenDate
    })
    submitting.value = false
    visible.value = false
    return
  }

  if (!props.closure || typeof props.closure.id !== 'number') return
  if (!reopenForm.reopenedAt) {
    ElMessage.warning('请选择实际恢复日期')
    return
  }
  if (reopenForm.reopenedAt < props.closure.closedAt) {
    ElMessage.warning('实际恢复日期不能早于封营日期')
    return
  }
  submitting.value = true
  emit('submit', {
    kind: 'reopen',
    closureId: props.closure.id,
    reopenedAt: reopenForm.reopenedAt,
    operator: reopenForm.operator.trim() || '未署名',
    note: reopenForm.note.trim()
  })
  submitting.value = false
  visible.value = false
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="mode === 'close' ? `封营 · ${site?.code ?? ''} ${site?.name ?? ''}` : `恢复营位 · ${site?.code ?? ''} ${site?.name ?? ''}`"
    width="560px"
    @update:model-value="visible = $event"
  >
    <el-form v-if="mode === 'close'" label-width="110px" @submit.prevent>
      <el-form-item label="封营原因">
        <el-select v-model="closeForm.reasonType" style="width: 100%">
          <el-option v-for="t in CLOSURE_REASON_TYPES" :key="t" :label="t" :value="t" />
        </el-select>
      </el-form-item>
      <el-form-item label="原因说明" required>
        <el-input
          v-model="closeForm.reason"
          type="textarea"
          :rows="3"
          :placeholder="CLOSURE_REASON_HINTS[closeForm.reasonType]"
        />
      </el-form-item>
      <el-form-item label="操作人">
        <el-input v-model="closeForm.operator" placeholder="如 李营" />
      </el-form-item>
      <el-form-item label="封营日期" required>
        <el-date-picker
          v-model="closeForm.closedAt"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="计划恢复日期" required>
        <el-date-picker
          v-model="closeForm.plannedReopenDate"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <p class="closure-dialog__hint">
        封营期间该营位不进名次表与地图推荐，不计入最高分与等级统计；得分、因子与否决记录保留，可在「封营管理」单独查看，恢复后立即按当前方案参与排名。
      </p>
    </el-form>

    <el-form v-else label-width="110px" @submit.prevent>
      <div v-if="closure" class="closure-dialog__summary">
        <p>
          <el-tag type="warning" size="small">{{ closure.reasonType }}</el-tag>
          <span class="ml8">{{ closure.reason }}</span>
        </p>
        <p class="muted">
          封营日期 {{ formatDate(closure.closedAt) }} · 计划恢复 {{ formatDate(closure.plannedReopenDate) }} ·
          操作人 {{ closure.operator }}
        </p>
      </div>
      <el-form-item label="实际恢复日期" required>
        <el-date-picker
          v-model="reopenForm.reopenedAt"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="恢复操作人">
        <el-input v-model="reopenForm.operator" placeholder="如 李营" />
      </el-form-item>
      <el-form-item label="恢复备注">
        <el-input
          v-model="reopenForm.note"
          type="textarea"
          :rows="2"
          placeholder="可记录提前恢复的原因，或逾期补恢复的说明"
        />
      </el-form-item>
      <el-alert :title="reopenHint" type="info" :closable="false" show-icon />
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button :type="mode === 'close' ? 'warning' : 'success'" :loading="submitting" @click="handleSubmit">
        {{ mode === 'close' ? '确认封营' : '确认恢复' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.closure-dialog__hint {
  margin: 4px 0 0;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.7;
  color: #92400e;
  background: #fff8e6;
  border: 1px solid #f5e0ae;
  border-radius: 7px;
}
.closure-dialog__summary {
  margin: 0 0 14px;
  padding: 9px 12px;
  background: var(--gb-surface, #f5faf6);
  border-radius: 8px;
}
.closure-dialog__summary p {
  margin: 3px 0;
  font-size: 13px;
  color: var(--gb-ink, #1f2a24);
}
.closure-dialog__summary .muted {
  color: var(--gb-muted, #7d907f);
  font-size: 12px;
}
.ml8 {
  margin-left: 8px;
}
</style>
