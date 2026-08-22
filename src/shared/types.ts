export type ModelChoice = 'default' | 'haiku' | 'sonnet'

/** 매일 자동실행 모드: 끄기 / 컨펌 후 실행 / 조용히 실행 */
export type DailyAutoMode = 'off' | 'confirm' | 'silent'

/** 사용자가 설정 탭에서 자유롭게 편집하는 프롬프트 템플릿 */
export interface PromptTemplates {
  /** 일일 요약. 플레이스홀더: {date} {weekday} {digest} */
  day: string
  /**
   * 주간/월간 한 줄 요약. {data}로 일별 헤드라인만 받는다.
   * 상세 항목을 같이 넘기면 한 줄이 항목 나열로 흐른다. 플레이스홀더: {label} {data}
   */
  periodOverview: string
  /**
   * 주간/월간 상세 요약. {data}로 일별 항목만 받는다. 플레이스홀더: {label} {data}
   */
  periodDetail: string
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

/**
 * 기간 요약의 한 부분.
 *
 * 부분마다 따로 만들 수 있으므로 만든 시각·모델·반영 범위도 부분마다 갖는다.
 * 하나로 두면 제목만 다시 만들어도 내용의 생성 시각까지 바뀌어 화면이 거짓말을 한다.
 */
export interface PeriodPart {
  text: string
  /** 만들 때 반영한 마지막 날짜 (오늘 이후로 잘린다) */
  end: string
  model: string
  generatedAt: string
  /** 구간이 끝나기 전에 만들어 아직 덜 반영된 부분 (조회 시 계산) */
  stale?: boolean
}

/** 기간 요약의 두 부분. 서로 다른 데이터를 보고 따로 만든다 */
export type PeriodPartKind = 'overview' | 'detail'

/** 생성 중인 기간 요약의 글 조각. 어느 부분의 것인지 함께 보낸다 */
export interface PeriodStreamEvent {
  part: PeriodPartKind
  kind: 'reset' | 'delta'
  text?: string
}

/** 주간/월간 자유 텍스트 요약. key 예: "2026-W29", "2026-07" */
export interface PeriodSummary {
  key: string
  kind: 'week' | 'month'
  /** 구간 자체의 시작/끝 (KST, inclusive). 부분의 반영 범위와는 다르다 */
  start: string
  end: string
  /** 제목. 날짜별 헤드라인만 보고 만든 한 줄 */
  overview: PeriodPart | null
  /** 내용. 날짜별 항목만 보고 만든 상세 */
  detail: PeriodPart | null
}

/** 임의 구간(주/월 공용)의 활동 현황. end는 오늘 이후로 넘어가지 않게 잘린다. */
export interface RangeStatus {
  start: string
  end: string
  /** 활동이 있는 KST 날짜 목록 */
  activeDays: string[]
  /** 요약 캐시가 있는 날짜 목록 (활동 없는 날 센티널은 제외) */
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
  rangeList: 'range:list',
  rangeBackfill: 'range:backfill',
  dayGenerate: 'day:generate',
  dayGetDigest: 'day:getDigest',
  periodGet: 'period:get',
  periodGenerate: 'period:generate',
  periodStream: 'period:stream',
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
}

/** preload가 contextBridge로 노출하고 렌더러가 사용하는 API 표면 */
export interface WorklogApi {
  /** 'win32' | 'darwin' 등. 플랫폼별 안내 문구 분기에 쓴다 */
  readonly platform: string
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getDefaultPrompts(): Promise<PromptTemplates>
  detectClaude(): Promise<ClaudeInfo>
  testClaude(path: string): Promise<ClaudeInfo>
  /** 구간의 날짜별 요약 목록 (캐시만 조회, 생성 안 함) + 활동 여부 */
  listRange(start: string, end: string): Promise<{ status: RangeStatus; summaries: DaySummary[] }>
  /**
   * 구간의 미요약 활동일을 하나씩 순차 생성한다. 조합은 하지 않는다.
   * 진행률은 onBackfillProgress로 오고 cancelBackfill로 중단할 수 있다.
   */
  backfillRange(start: string, end: string): Promise<RangeStatus>
  /** 특정 날짜 요약 생성 (force면 캐시 무시) */
  generateDay(date: string, force?: boolean): Promise<DaySummary>
  /**
   * 원본 추출 내역. AI 호출 없이 로컬 로그 파싱만으로 만든다 (토큰 소모 0).
   * 기본은 캐시 우선이며, force=true면 원본 로그를 다시 스캔한다.
   */
  getDayDigest(date: string, force?: boolean): Promise<DayDigest>
  getPeriod(key: string): Promise<PeriodSummary | null>
  /** 주간/월간 요약 생성. 구간의 모든 활동일이 요약돼 있어야 한다 (claude 1회) */
  generatePeriod(req: PeriodRequest, part: PeriodPartKind): Promise<PeriodSummary>
  /**
   * 기간 요약이 만들어지는 동안 글 조각을 받는다.
   * reset은 재시도로 처음부터 다시 쓴다는 뜻이므로 받아둔 글을 버려야 한다.
   */
  onPeriodStream(cb: (e: PeriodStreamEvent) => void): () => void
  cancelBackfill(): Promise<void>
  copyToClipboard(text: string): Promise<void>
  setAutoLaunch(enabled: boolean): Promise<void>
  /** 창 고정 여부. 고정 중에는 포커스를 잃어도 창이 닫히지 않는다 */
  getWindowPinned(): Promise<boolean>
  setWindowPinned(pinned: boolean): Promise<boolean>
  onBackfillProgress(cb: (p: BackfillProgress) => void): () => void
  onPipelineError(cb: (e: PipelineError) => void): () => void
  /** 자동실행 등으로 main이 요약을 갱신했을 때 */
  onDayUpdated(cb: (s: DaySummary) => void): () => void
}
