import { claudeWorkdir, readJson, reportPath, writeJsonAtomic } from '../cache'
import { locateClaude } from '../claude/locate'
import { extractJson, runClaude } from '../claude/run'
import { renderTemplate } from '../prompts'
import { getSettings } from '../settings'
import { daysOfMonth, shortDateKo } from '@shared/dates'
import { EXCEL_HEADERS, profileToRow } from '@shared/excel-format'
import type { DaySummary, MonthReport, MonthStatus, Profile } from '@shared/types'
import { activityInRange, type Activity } from './activity'
import {
  ensureDaySummary,
  getCachedDaySummary,
  renderDailyLines,
  todayKst
} from './summarizer'
import { throwIfCancelled, type ProgressFn } from './queue'

/** 해당 월의 활동 (오늘까지, KST) */
export async function monthActivity(ym: string): Promise<Activity> {
  const today = todayKst()
  const days = daysOfMonth(ym).filter((d) => d <= today)
  if (days.length === 0) return { dates: [], digests: new Map() }
  return activityInRange(days[0], days[days.length - 1])
}

export async function getMonthStatus(ym: string): Promise<MonthStatus> {
  const { dates } = await monthActivity(ym)
  const summarizedDays: string[] = []
  for (const d of dates) {
    const s = await getCachedDaySummary(d)
    if (s && !s.empty) summarizedDays.push(d)
  }
  return { ym, activeDays: dates, summarizedDays }
}

export async function getCachedReport(ym: string): Promise<MonthReport | null> {
  return readJson<MonthReport>(reportPath(ym))
}

interface GianJson {
  purpose?: string
  outputs?: string
}

/**
 * 월간 기안 초안 생성:
 * 활동일의 일별 요약을 백필 → claude 1회 호출로 사용 목적/예상 업무 결과물 생성 →
 * 증빙 부록은 코드로 결정적 조립 → 본문 텍스트/엑셀 TSV 렌더.
 */
export async function generateMonthReport(
  ym: string,
  onProgress?: ProgressFn
): Promise<MonthReport> {
  onProgress?.({ done: 0, total: 0, currentDate: null, phase: 'scan' })
  const { dates: activeDays, digests } = await monthActivity(ym)
  if (activeDays.length === 0) throw new Error('이 달에는 Claude Code 활동 기록이 없습니다')

  const summaries: DaySummary[] = []
  for (let i = 0; i < activeDays.length; i++) {
    throwIfCancelled()
    const date = activeDays[i]
    onProgress?.({ done: i, total: activeDays.length, currentDate: date, phase: 'summarize' })
    const digest = digests.get(date)
    if (digest) {
      summaries.push(await ensureDaySummary(date, { preCollected: digest }))
    } else {
      // 원본 로그가 이미 정리된 날짜 — 남아 있는 요약 캐시를 그대로 쓴다
      const cached = await getCachedDaySummary(date)
      if (cached) summaries.push(cached)
    }
  }

  throwIfCancelled()
  onProgress?.({
    done: activeDays.length,
    total: activeDays.length,
    currentDate: null,
    phase: 'report'
  })

  const settings = await getSettings()
  const [y, m] = ym.split('-').map(Number)
  const prompt = renderTemplate(settings.prompts.gian, {
    ym: `${y}년 ${m}월`,
    savedHours: settings.monthlySavedHours == null ? '없음' : `${settings.monthlySavedHours}시간`,
    data: renderDailyLines(summaries)
  })
  const raw = await runClaude(prompt, {
    claudePath: await locateClaude(settings.claudePath),
    model: settings.model,
    cwd: claudeWorkdir()
  })
  const parsed = extractJson<GianJson>(raw)
  const purpose = (parsed?.purpose ?? raw.replace(/\s+/g, ' ').trim().slice(0, 200)).trim()
  const outputs = (parsed?.outputs ?? '').trim()

  const appendix = buildAppendix(summaries)
  const profile = settings.profile
  const text = renderBodyText(profile, purpose, outputs)
  const excelTsv = [EXCEL_HEADERS.join('\t'), profileToRow(profile).join('\t')].join('\n')

  const report: MonthReport = {
    ym,
    purpose,
    outputs,
    appendix,
    text,
    excelTsv,
    generatedAt: new Date().toISOString()
  }
  await writeJsonAtomic(reportPath(ym), report)
  return report
}

function buildAppendix(summaries: DaySummary[]): string[] {
  const lines: string[] = []
  let n = 1
  for (const s of summaries) {
    if (s.empty) continue
    if (s.fallbackText) {
      lines.push(`${n++}. ${shortDateKo(s.date)} ${s.fallbackText.replace(/\s+/g, ' ').slice(0, 120)}`)
      continue
    }
    for (const item of s.items ?? []) {
      lines.push(`${n++}. ${shortDateKo(s.date)} [${item.project}] ${item.work}`)
    }
  }
  return lines
}

/** 기안 본문용 "필드: 값" 1줄씩 텍스트 덩어리 */
function renderBodyText(p: Profile, purpose: string, outputs: string): string {
  return [
    `기안 제목: ${p.gianTitle}`,
    `기안 링크: ${p.gianLink}`,
    `기안 승인일: ${p.gianApprovedDate}`,
    `법인: ${p.corp}`,
    `소속: ${p.dept}`,
    `이름: ${p.name}`,
    `사번: ${p.empNo}`,
    `회사메일: ${p.email}`,
    `사용 중인 AI 서비스: ${p.aiService}`,
    `구독 플랜: ${p.plan}`,
    `결제주기: ${p.billingCycle}`,
    `금액(현지통화): ${p.amount}`,
    `사용 목적: ${purpose}`,
    `예상 업무 결과물: ${outputs}`
  ].join('\n')
}
