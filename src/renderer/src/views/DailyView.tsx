import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { kstDateOf, kstDateTimeKo, shortDateKo, ymOf } from '@shared/dates'
import { renderDigestText } from '@shared/digest-text'
import type { DayDigest, DaySummary, MonthStatus } from '@shared/types'
import { CopyButton, MonthNav, Spinner, errMsg, modelLabel } from '../common'

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
  // 한 번 읽은 원본 내역은 메모리에 두고 재사용한다 (날짜를 다시 펼쳐도 재스캔 없음)
  const [digests, setDigests] = useState<Map<string, DayDigest>>(new Map())
  const [digestBusy, setDigestBusy] = useState<string | null>(null)
  const [digestErr, setDigestErr] = useState<string | null>(null)

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

  const loadDigest = useCallback(
    (date: string, force = false): void => {
      if (!force && digests.has(date)) return
      setDigestBusy(date)
      setDigestErr(null)
      window.api
        .getDayDigest(date, force)
        .then((d) => setDigests((prev) => new Map(prev).set(date, d)))
        .catch((e: unknown) => setDigestErr(errMsg(e)))
        .finally(() => setDigestBusy(null))
    },
    [digests]
  )

  const generate = (date: string, force?: boolean): void => {
    setBusyDate(date)
    setError(null)
    window.api
      .generateDay(date, force)
      .then((s) => {
        setSummaries((prev) => new Map(prev).set(date, s))
        // 요약을 새로 만들었으면 원본 내역도 최신 스캔 결과로 교체한다
        setDigests((prev) => {
          const next = new Map(prev)
          next.delete(date)
          return next
        })
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
                {s ? (
                  <span className={`badge${s.empty ? '' : ' on'}`}>
                    {s.empty ? '없음' : 'AI 요약됨'}
                  </span>
                ) : (
                  // 미요약 배지는 그 자리에서 생성을 실행한다.
                  // stopPropagation이 없으면 행 펼치기까지 함께 발동한다.
                  // 이미 요약된 날짜는 버튼으로 만들지 않는다 — 실수로 눌러 쿼터를 쓰는 것을 막고,
                  // 강제 재생성은 행을 펼친 뒤 '다시 생성'으로만 하게 둔다.
                  <button
                    type="button"
                    className="badge action"
                    disabled={busyDate !== null}
                    title={`${shortDateKo(date)} AI 요약 생성`}
                    onClick={(e) => {
                      e.stopPropagation()
                      generate(date)
                    }}
                  >
                    {busyDate === date ? '생성 중…' : '요약 생성'}
                  </button>
                )}
              </div>
              {open && (
                <DayDetail
                  date={date}
                  summary={s ?? null}
                  busy={busyDate === date}
                  onGenerate={(force) => generate(date, force)}
                  digest={digests.get(date) ?? null}
                  digestBusy={digestBusy === date}
                  digestErr={digestBusy === date ? null : digestErr}
                  onLoadDigest={(force) => loadDigest(date, force)}
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
  onGenerate,
  digest,
  digestBusy,
  digestErr,
  onLoadDigest
}: {
  date: string
  summary: DaySummary | null
  busy: boolean
  onGenerate: (force?: boolean) => void
  digest: DayDigest | null
  digestBusy: boolean
  digestErr: string | null
  onLoadDigest: (force?: boolean) => void
}): ReactNode {
  const hasAi = !!summary && !summary.empty
  const [sub, setSub] = useState<'raw' | 'ai'>(hasAi ? 'ai' : 'raw')

  // 요약이 막 생성되면 결과가 보이도록 AI 탭으로 전환한다 (false→true 전이에서만)
  useEffect(() => {
    if (hasAi) setSub('ai')
  }, [hasAi])

  // 원본 탭을 처음 열 때만 읽는다 — 이미 읽어둔 날짜는 상위 캐시에서 즉시 표시된다
  useEffect(() => {
    if (sub === 'raw' && !digest && !digestBusy) onLoadDigest()
  }, [sub, digest, digestBusy, onLoadDigest])

  // 화면에 보이는 것과 복사되는 것이 같아야 한다 — 키워드가 빠지면 그 줄은
  // 선택도 복사도 안 되는 죽은 텍스트가 된다
  const keywords = summary?.keywords ?? []
  const aiText =
    summary && !summary.empty
      ? summary.fallbackText ??
        [
          `${shortDateKo(date)} ${summary.headline ?? ''}`,
          ...(summary.items ?? []).map((i) => `- [${i.project}] ${i.work}`),
          ...(keywords.length > 0 ? [`키워드: ${keywords.join(', ')}`] : [])
        ].join('\n')
      : ''

  return (
    <div className="day-detail">
      <div className="row spread">
        <div className="subtabs">
          <button type="button" className={sub === 'raw' ? 'active' : ''} onClick={() => setSub('raw')}>
            원본 내역
          </button>
          <button type="button" className={sub === 'ai' ? 'active' : ''} onClick={() => setSub('ai')}>
            AI 요약
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
              <strong className="selectable">{summary.headline}</strong>
              <ul className="items">
                {(summary.items ?? []).map((i, idx) => (
                  <li key={idx}>
                    <span className="muted">[{i.project}]</span> {i.work}
                  </li>
                ))}
              </ul>
              {/* 키워드·모델·생성시각은 요약 본문이 아니라 그 요약에 붙는 정보라 선으로 가른다 */}
              <div className="detail-foot">
                <div className="row spread">
                  <span className="muted selectable grow">{keywords.join(', ')}</span>
                  <button type="button" className="btn" disabled={busy} onClick={() => onGenerate(true)}>
                    {busy ? '생성 중…' : '다시 생성'}
                  </button>
                </div>
                <div className="muted">
                  {modelLabel(summary.model)} · {kstDateTimeKo(summary.generatedAt)}
                </div>
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
          {digestBusy && <Spinner label="원본 내역 추출 중… (AI 호출 없음)" />}
          {digest && (
            <>
              {digest.projects.length === 0 ? (
                <div className="muted">기록이 없습니다.</div>
              ) : (
                <div className="pre">{renderDigestText(digest)}</div>
              )}
              <div className="detail-foot">
                <div className="row spread">
                  <span className="muted">{kstDateTimeKo(digest.builtAt)} 추출됨</span>
                  <button
                    type="button"
                    className="btn"
                    disabled={digestBusy}
                    onClick={() => onLoadDigest(true)}
                  >
                    {digestBusy ? '읽는 중…' : '새로고침'}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
