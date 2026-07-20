import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { kstDateOf, shortDateKo, ymOf } from '@shared/dates'
import { renderDigestText } from '@shared/digest-text'
import type { DayDigest, DaySummary, MonthStatus } from '@shared/types'
import { CopyButton, MonthNav, Spinner, errMsg } from '../common'

export default function DailyView(): ReactNode {
  // 자정을 넘겨도 "오늘"이 어제로 굳지 않도록 창이 열릴 때마다 재평가한다
  const [today, setToday] = useState(() => kstDateOf(Date.now()))
  const [ym, setYm] = useState(ymOf(today))
  const [status, setStatus] = useState<MonthStatus | null>(null)
  const [summaries, setSummaries] = useState<Map<string, DaySummary>>(new Map())
  const [loading, setLoading] = useState(false)
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 월을 빠르게 전환할 때 이전 월 응답이 늦게 도착해 덮어쓰는 것을 막는다
  const reqRef = useRef(0)

  const load = useCallback((): void => {
    const id = ++reqRef.current
    setLoading(true)
    setError(null)
    window.api
      .listDays(ym)
      .then((r) => {
        if (id !== reqRef.current) return
        setStatus(r.status)
        setSummaries(new Map(r.summaries.map((s) => [s.date, s])))
      })
      .catch((e: unknown) => {
        if (id === reqRef.current) setError(errMsg(e))
      })
      .finally(() => {
        if (id === reqRef.current) setLoading(false)
      })
  }, [ym])

  useEffect(load, [load])
  useEffect(() => window.api.onDayUpdated(() => load()), [load])

  useEffect(() => {
    const refreshToday = (): void => setToday(kstDateOf(Date.now()))
    window.addEventListener('focus', refreshToday)
    return () => window.removeEventListener('focus', refreshToday)
  }, [])

  const generate = (date: string, force?: boolean): void => {
    setBusyDate(date)
    setError(null)
    window.api
      .generateDay(date, force)
      .then((s) => {
        setSummaries((prev) => new Map(prev).set(date, s))
        setOpenDate(date)
      })
      .catch((e: unknown) => setError(errMsg(e)))
      .finally(() => setBusyDate(null))
  }

  const days = [...(status?.activeDays ?? [])].sort().reverse()

  return (
    <>
      <div className="card">
        <MonthNav ym={ym} onChange={setYm} />
        {ym === ymOf(today) && (
          <button
            type="button"
            className="btn primary"
            disabled={busyDate !== null}
            onClick={() => generate(kstDateOf(Date.now()), true)}
          >
            {busyDate === today ? '오늘 요약 생성 중…' : '오늘 하루 정리하기'}
          </button>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        {loading && <Spinner label="기록을 읽는 중…" />}
        {!loading && days.length === 0 && (
          <div className="muted">이 달에는 Claude Code 활동 기록이 없습니다.</div>
        )}
        {days.map((date) => {
          const s = summaries.get(date)
          const open = openDate === date
          return (
            <div key={date} className="day-item">
              <div
                className="row spread"
                onClick={() => setOpenDate(open ? null : date)}
                role="button"
              >
                <strong>{shortDateKo(date)}</strong>
                <span className="grow muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s?.empty ? '활동 없음' : (s?.headline ?? s?.fallbackText?.slice(0, 40) ?? '')}
                </span>
                <span className={`badge${s && !s.empty ? ' on' : ''}`}>
                  {s ? (s.empty ? '없음' : 'AI 요약됨') : '미요약'}
                </span>
              </div>
              {open && (
                <DayDetail
                  date={date}
                  summary={s ?? null}
                  busy={busyDate === date}
                  onGenerate={(force) => generate(date, force)}
                />
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function DayDetail({
  date,
  summary,
  busy,
  onGenerate
}: {
  date: string
  summary: DaySummary | null
  busy: boolean
  onGenerate: (force?: boolean) => void
}): ReactNode {
  const hasAi = !!summary && !summary.empty
  const [sub, setSub] = useState<'ai' | 'raw'>(hasAi ? 'ai' : 'raw')
  const [digest, setDigest] = useState<DayDigest | null>(null)
  const [digestErr, setDigestErr] = useState<string | null>(null)

  // 요약이 막 생성되면 결과가 보이도록 AI 탭으로 전환한다 (false→true 전이에서만)
  useEffect(() => {
    if (hasAi) setSub('ai')
  }, [hasAi])

  // 재생성 후에는 원본 내역도 다시 읽는다
  const generatedAt = summary?.generatedAt
  useEffect(() => {
    setDigest(null)
    setDigestErr(null)
  }, [generatedAt])

  useEffect(() => {
    if (sub !== 'raw' || digest) return
    let alive = true
    window.api
      .getDayDigest(date)
      .then((d) => alive && setDigest(d))
      .catch((e: unknown) => alive && setDigestErr(errMsg(e)))
    return () => {
      alive = false
    }
  }, [sub, digest, date])

  const aiText =
    summary && !summary.empty
      ? summary.fallbackText ??
        [
          `${shortDateKo(date)} ${summary.headline ?? ''}`,
          ...(summary.items ?? []).map((i) => `- [${i.project}] ${i.work}`)
        ].join('\n')
      : ''

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row spread">
        <div className="subtabs">
          <button type="button" className={sub === 'ai' ? 'active' : ''} onClick={() => setSub('ai')}>
            AI 요약
          </button>
          <button type="button" className={sub === 'raw' ? 'active' : ''} onClick={() => setSub('raw')}>
            원본 내역
          </button>
        </div>
        {sub === 'ai' && hasAi && <CopyButton text={aiText} />}
        {sub === 'raw' && digest && <CopyButton text={renderDigestText(digest)} label="원본 복사" />}
      </div>

      {sub === 'ai' &&
        (hasAi ? (
          summary.fallbackText ? (
            <div className="pre">{summary.fallbackText}</div>
          ) : (
            <>
              <strong>{summary.headline}</strong>
              <ul className="items">
                {(summary.items ?? []).map((i, idx) => (
                  <li key={idx}>
                    <span className="muted">[{i.project}]</span> {i.work}
                  </li>
                ))}
              </ul>
              <div className="row spread">
                <span className="muted">{(summary.keywords ?? []).join(' · ')}</span>
                <button type="button" className="btn" disabled={busy} onClick={() => onGenerate(true)}>
                  {busy ? '생성 중…' : '다시 생성'}
                </button>
              </div>
            </>
          )
        ) : (
          <div className="row spread">
            <span className="muted">
              AI 요약이 아직 없습니다. 원본 내역은 토큰 소모 없이 볼 수 있어요.
            </span>
            <button type="button" className="btn primary" disabled={busy} onClick={() => onGenerate()}>
              {busy ? '생성 중…' : 'AI 요약 생성'}
            </button>
          </div>
        ))}

      {sub === 'raw' && (
        <>
          {digestErr && <div className="error">{digestErr}</div>}
          {!digest && !digestErr && <Spinner label="원본 내역 추출 중… (AI 호출 없음)" />}
          {digest &&
            (digest.projects.length === 0 ? (
              <div className="muted">기록이 없습니다.</div>
            ) : (
              <div className="pre">{renderDigestText(digest)}</div>
            ))}
        </>
      )}
    </div>
  )
}
