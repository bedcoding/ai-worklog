import { useEffect, useState, type ReactNode } from 'react'
import { addDays, kstDateOf, shortDateKo, weekKeyOf, weekRange } from '@shared/dates'
import type { PeriodSummary } from '@shared/types'
import { CopyButton, Spinner, errMsg } from '../common'

export default function WeekView(): ReactNode {
  const [key, setKey] = useState(weekKeyOf(kstDateOf(Date.now())))
  const [period, setPeriod] = useState<PeriodSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { start, end } = weekRange(key)

  useEffect(() => {
    setPeriod(null)
    setError(null)
    let alive = true
    window.api
      .getPeriod(key)
      .then((p) => alive && setPeriod(p))
      .catch((e: unknown) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [key])

  const move = (delta: number): void => setKey(weekKeyOf(addDays(start, delta * 7)))

  const generate = (source: 'daily' | 'raw'): void => {
    const reqKey = key
    setBusy(true)
    setError(null)
    window.api
      .generatePeriod({ kind: 'week', key: reqKey, source })
      .then((p) => reqKey === key && setPeriod(p))
      .catch((e: unknown) => reqKey === key && setError(errMsg(e)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="card">
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={() => move(-1)}>
            ◀
          </button>
          <strong className="grow" style={{ textAlign: 'center' }}>
            {shortDateKo(start)} ~ {shortDateKo(end)}
          </strong>
          <button type="button" className="btn" disabled={busy} onClick={() => move(1)}>
            ▶
          </button>
        </div>
        <div className="grid2">
          <button type="button" className="btn primary" disabled={busy} onClick={() => generate('daily')}>
            일일 요약 조합으로 생성
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => generate('raw')}>
            원본 대화에서 생성
          </button>
        </div>
        <div className="muted">
          일일 요약 조합: 캐시된 일별 요약을 재활용해 빠르고 저렴 (미요약 날짜는 자동 백필) ·
          원본: 이 주의 원본 기록을 통째로 새로 요약
        </div>
        {error && <div className="error">{error}</div>}
        {busy && <Spinner label="주간 요약 생성 중…" />}
      </div>

      {period && (
        <div className="card">
          <div className="row spread">
            <h3>주간 요약</h3>
            <span className="muted">
              {period.source === 'daily' ? '일일 조합' : '원본'} ·{' '}
              {shortDateKo(period.start)}~{shortDateKo(period.end)} 반영
            </span>
            <CopyButton text={period.text} />
          </div>
          {period.stale && (
            <div className="muted">
              ⚠️ {shortDateKo(period.end)}까지만 반영된 요약입니다. 다시 생성하세요.
            </div>
          )}
          <div className="pre">{period.text}</div>
        </div>
      )}
    </>
  )
}
