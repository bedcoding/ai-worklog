import { useEffect, useState, type ReactNode } from 'react'
import { kstDateOf, ymOf } from '@shared/dates'
import type { MonthStatus, PeriodSummary } from '@shared/types'
import { CopyButton, MonthNav, Spinner, errMsg } from '../common'

export default function MonthView(): ReactNode {
  const [ym, setYm] = useState(ymOf(kstDateOf(Date.now())))
  const [statusInfo, setStatusInfo] = useState<MonthStatus | null>(null)
  const [period, setPeriod] = useState<PeriodSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 월을 전환하면 이전 월의 응답이 늦게 도착해도 무시한다
  useEffect(() => {
    setPeriod(null)
    setStatusInfo(null)
    setError(null)
    let alive = true
    void window.api.getPeriod(ym).then((p) => alive && setPeriod(p))
    window.api
      .getMonthStatus(ym)
      .then((s) => alive && setStatusInfo(s))
      .catch((e: unknown) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [ym])

  const generate = (source: 'daily' | 'raw'): void => {
    const reqYm = ym
    setBusy(true)
    setError(null)
    window.api
      .generatePeriod({ kind: 'month', key: reqYm, source })
      .then((p) => reqYm === ym && setPeriod(p))
      .catch((e: unknown) => reqYm === ym && setError(errMsg(e)))
      .finally(() => setBusy(false))
  }

  // 아직 요약되지 않은 활동일 수. '일일 조합'이 claude를 몇 번 부를지 결정한다
  const summarized = new Set(statusInfo?.summarizedDays ?? [])
  const pending = (statusInfo?.activeDays ?? []).filter((d) => !summarized.has(d)).length

  return (
    <>
      <div className="card">
        <MonthNav ym={ym} onChange={setYm} disabled={busy} />
        {statusInfo && (
          <div className="muted">
            활동 {statusInfo.activeDays.length}일 중 {statusInfo.activeDays.length - pending}일
            요약됨
          </div>
        )}
        {/* 어느 쪽이 싼지는 캐시 상태에 따라 뒤집힌다. 한쪽을 primary로 강조하면
            비싼 쪽으로 유도할 수 있으므로 둘 다 같은 무게로 둔다. */}
        <div className="grid2">
          <button type="button" className="btn" disabled={busy} onClick={() => generate('daily')}>
            일일 요약 조합으로 생성
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => generate('raw')}>
            원본 대화에서 생성
          </button>
        </div>
        <div className="muted">
          일일 조합: 날짜별 요약을 이어 붙입니다
          {statusInfo === null
            ? ''
            : pending > 0
              ? `. 밀린 ${pending}일을 먼저 만들어 claude를 ${pending + 1}번 부릅니다`
              : '. 모두 요약돼 있어 claude를 1번 부릅니다'}
          .
        </div>
        <div className="muted">
          원본: 이 달 기록을 한 번에 넘겨 claude를 1번 부릅니다. 양이 많으면 날짜별로 잘립니다.
        </div>
        {error && <div className="error">{error}</div>}
        {busy && <Spinner label="월간 요약 생성 중…" />}
      </div>

      {period && (
        <div className="card">
          <div className="row spread">
            <h3>월간 요약</h3>
            <span className="muted">
              {period.source === 'daily' ? '일일 조합' : '원본'} · {period.start}~{period.end} 반영
            </span>
            <CopyButton text={period.text} />
          </div>
          {period.stale && (
            <div className="muted">⚠️ {period.end}까지만 반영된 요약입니다. 다시 생성하세요.</div>
          )}
          <div className="pre">{period.text}</div>
        </div>
      )}
    </>
  )
}
