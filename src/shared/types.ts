export type ModelChoice = 'default' | 'haiku' | 'sonnet'

/** 매일 자동실행 모드: 끄기 / 컨펌 후 실행 / 조용히 실행 */
export type DailyAutoMode = 'off' | 'confirm' | 'silent'

/** 사용자가 설정 탭에서 자유롭게 편집하는 프롬프트 템플릿 */
export interface PromptTemplates {
  /** 일일 요약. 플레이스홀더: {date} {weekday} {digest} */
  day: string
  /** 주간/월간 요약 (일일 조합·원본 공용). 플레이스홀더: {label} {data} */
  period: string
}

export interface Settings {
  /** null이면 자동 탐지 */
  claudePath: string | null
  model: ModelChoice
  autoLaunch: boolean
  dailyAuto: DailyAutoMode
  /** "HH:mm" (KST, 로컬 시각) */
  dailyTime: string
  /**
   * 원본 추출(digest) 캐시 보관 기간(개월). 0이면 무제한.
   * AI 요약 캐시는 용량이 미미해 영구 보관하며,
   * ~/.claude 원본 로그는 이 앱이 절대 삭제하지 않는다.
   */
  retentionMonths: number
  prompts: PromptTemplates
}

export interface DigestPrompt {
  hhmm: string
  text: string
  /** 유사 프롬프트 병합 개수 (2 이상일 때만 존재) */
  repeat?: number
}

export interface ProjectDigest {
  /** cwd의 basename */
  name: string
  cwd: string
  branches: string[]
  sessionCount: number
  promptCount: number
  toolCallCount: number
  tokens: { input: number; output: number }
  prompts: DigestPrompt[]
  /** 절단 예산 초과로 생략된 프롬프트 수 */
  overflow?: number
}

export interface DayDigest {
  /** KST 기준 YYYY-MM-DD */
  date: string
  projects: ProjectDigest[]
  totals: {
    sessionCount: number
    promptCount: number
    toolCallCount: number
    tokens: { input: number; output: number }
  }
  skippedLines: number
  builtAt: string
}

/** 렌더러에 digest 원문 대신 넘기는 가벼운 메타 */
export interface DayDigestMeta {
  date: string
  projectNames: string[]
  promptCount: number
  skippedLines: number
}

export interface DaySummaryItem {
  project: string
  work: string
}

export interface DaySummary {
  date: string
  digestHash: string
  model: string
  generatedAt: string
  /** 활동 없는 날 센티널 */
  empty?: boolean
  headline?: string
  items?: DaySummaryItem[]
  keywords?: string[]
  /** JSON 파싱 실패 시 원문 텍스트 폴백 */
  fallbackText?: string
}

/** 주간/월간 자유 텍스트 요약. key 예: "2026-W29", "2026-07" */
export interface PeriodSummary {
  key: string
  kind: 'week' | 'month'
  /** 시작/끝 날짜 (KST, inclusive) */
  start: string
  end: string
  source: 'daily' | 'raw'
  text: string
  model: string
  generatedAt: string
  /** 기간이 끝나기 전에 생성되어 end까지만 반영된 요약 (조회 시 계산) */
  stale?: boolean
}

export interface MonthStatus {
  ym: string
  /** 활동이 있는 KST 날짜 목록 */
  activeDays: string[]
  /** 요약 캐시가 존재하는 날짜 목록 (empty 센티널 포함) */
  summarizedDays: string[]
}

export interface ClaudeInfo {
  path: string
  version: string
}

export type BackfillPhase = 'scan' | 'summarize' | 'idle'

export interface BackfillProgress {
  done: number
  total: number
  currentDate: string | null
  phase: BackfillPhase
}

export interface PipelineError {
  scope: 'day' | 'period' | 'claude'
  date?: string
  message: string
  retryable: boolean
}

export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  promptsDefaults: 'prompts:defaults',
  claudeDetect: 'claude:detect',
  claudeTest: 'claude:test',
  dayList: 'day:list',
  dayGenerate: 'day:generate',
  dayGetDigest: 'day:getDigest',
  periodGet: 'period:get',
  periodGenerate: 'period:generate',
  monthGetStatus: 'month:getStatus',
  backfillCancel: 'backfill:cancel',
  clipboardWrite: 'clipboard:write',
  appSetAutoLaunch: 'app:setAutoLaunch',
  windowPinGet: 'window:pinGet',
  windowPinSet: 'window:pinSet',
  // main → renderer push
  backfillProgress: 'backfill:progress',
  pipelineError: 'pipeline:error',
  dayUpdated: 'day:updated'
} as const

export interface PeriodRequest {
  kind: 'week' | 'month'
  /** "2026-W29" 또는 "2026-07" */
  key: string
  source: 'daily' | 'raw'
}

/** preload가 contextBridge로 노출하고 렌더러가 사용하는 API 표면 */
export interface WorklogApi {
  /** 'win32' | 'darwin' | ... — 플랫폼별 안내 문구 분기에 쓴다 */
  readonly platform: string
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getDefaultPrompts(): Promise<PromptTemplates>
  detectClaude(): Promise<ClaudeInfo>
  testClaude(path: string): Promise<ClaudeInfo>
  /** 해당 월의 날짜별 요약 목록 (캐시만 조회, 생성 안 함) + 활동 여부 */
  listDays(ym: string): Promise<{ status: MonthStatus; summaries: DaySummary[] }>
  /** 특정 날짜 요약 생성 (force면 캐시 무시) */
  generateDay(date: string, force?: boolean): Promise<DaySummary>
  /**
   * 원본 추출 내역 — AI 호출 없이 로컬 로그 파싱만으로 만든다 (토큰 소모 0).
   * 기본은 캐시 우선이며, force=true면 원본 로그를 다시 스캔한다.
   */
  getDayDigest(date: string, force?: boolean): Promise<DayDigest>
  getPeriod(key: string): Promise<PeriodSummary | null>
  /** 주간/월간 요약 생성. source=daily면 미요약 날짜를 먼저 백필 */
  generatePeriod(req: PeriodRequest): Promise<PeriodSummary>
  getMonthStatus(ym: string): Promise<MonthStatus>
  cancelBackfill(): Promise<void>
  copyToClipboard(text: string): Promise<void>
  setAutoLaunch(enabled: boolean): Promise<void>
  /** 창 고정 여부 — 고정 중에는 포커스를 잃어도 창이 닫히지 않는다 */
  getWindowPinned(): Promise<boolean>
  setWindowPinned(pinned: boolean): Promise<boolean>
  onBackfillProgress(cb: (p: BackfillProgress) => void): () => void
  onPipelineError(cb: (e: PipelineError) => void): () => void
  /** 자동실행 등으로 main이 요약을 갱신했을 때 */
  onDayUpdated(cb: (s: DaySummary) => void): () => void
}
