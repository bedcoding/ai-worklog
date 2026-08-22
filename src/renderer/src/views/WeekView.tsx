import { useEffect, useState, type ReactNode } from 'react'
import { addDays, kstDateOf, shortDateKo, weekKeyOf, weekRange, ymOf } from '@shared/dates'
import type { PeriodSummary } from '@shared/types'
import { CopyButton, Spinner, errMsg } from '../common'

export default function WeekView(): ReactNode {
  const [key, setKey] = useState(weekKeyOf(kstDateOf(Date.now())))
  const [period, setPeriod] = useState<PeriodSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 아직 요약되지 않은 활동일 수. '일일 조합'이 claude를 몇 번 부를지 결정한다
  const [pending, setPending] = useState<number | null>(null)
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

  // 한 주는 달을 걸칠 수 있어 시작·끝 달의 상태를 모두 읽고 이 주 범위로 걸러낸다
  useEffect(() => {
    let alive = true
    setPending(null)
    const yms = [...new Set([ymOf(start), ymOf(end)])]
    void Promise.all(yms.map((m) => window.api.getMonthStatus(m)))
      .then((list) => {
        if (!alive) return
        const inWeek = (d: string): boolean => d >= start && d <= end
        const done = new Set(list.flatMap((s) => s.summarizedDays))
        setPending(
          list.flatMap((s) => s.activeDays).filter((d) => inWeek(d) && !done.has(d)).length
        )
      })
      // 개수는 안내용이라 실패하면 문구만 생략한다
      .catch(() => alive && setPending(null))
    return () => {
      alive = false
    }
  }, [start, end])

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
          {pending === null
            ? ''
            : pending > 0
              ? `. 밀린 ${pending}일을 먼저 만들어 claude를 ${pending + 1}번 부릅니다`
              : '. 모두 요약돼 있어 claude를 1번 부릅니다'}
          .
        </div>
        <div className="muted">
          원본: 이 주 기록을 한 번에 넘겨 claude를 1번 부릅니다. 양이 많으면 날짜별로 잘립니다.
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
