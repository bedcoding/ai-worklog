import { useEffect, useState, type ReactNode } from 'react'
import { kstDateOf, ymOf } from '@shared/dates'
import { EXCEL_HEADERS, profileToRow } from '@shared/excel-format'
import type { MonthReport, MonthStatus, PeriodSummary, Profile } from '@shared/types'
import { CopyButton, MonthNav, Spinner, errMsg } from '../common'

export default function MonthView(): ReactNode {
  const [ym, setYm] = useState(ymOf(kstDateOf(Date.now())))
  const [statusInfo, setStatusInfo] = useState<MonthStatus | null>(null)
  const [period, setPeriod] = useState<PeriodSummary | null>(null)
  const [report, setReport] = useState<MonthReport | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [busy, setBusy] = useState<'period' | 'report' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  // 월을 전환하면 이전 월의 응답이 늦게 도착해도 무시한다
  useEffect(() => {
    setPeriod(null)
    setReport(null)
    setStatusInfo(null)
    setError(null)
    setSavedPath(null)
    let alive = true
    void window.api.getPeriod(ym).then((p) => alive && setPeriod(p))
    void window.api.getReport(ym).then((r) => alive && setReport(r))
    void window.api.getSettings().then((s) => alive && setProfile(s.profile))
    window.api
      .getMonthStatus(ym)
      .then((s) => alive && setStatusInfo(s))
      .catch((e: unknown) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [ym])

  const generatePeriod = (source: 'daily' | 'raw'): void => {
    const reqYm = ym
    setBusy('period')
    setError(null)
    window.api
      .generatePeriod({ kind: 'month', key: reqYm, source })
      .then((p) => reqYm === ym && setPeriod(p))
      .catch((e: unknown) => reqYm === ym && setError(errMsg(e)))
      .finally(() => setBusy(null))
  }

  const generateReport = (): void => {
    const reqYm = ym
    setBusy('report')
    setError(null)
    window.api
      .generateReport(reqYm)
      .then((r) => reqYm === ym && setReport(r))
      .catch((e: unknown) => reqYm === ym && setError(errMsg(e)))
      .finally(() => setBusy(null))
  }

  const saveXlsx = (): void => {
    void window.api
      .saveReportXlsx(ym)
      .then((p) => setSavedPath(p))
      .catch((e: unknown) => setError(errMsg(e)))
  }

  return (
    <>
      <div className="card">
        <MonthNav ym={ym} onChange={setYm} disabled={busy !== null} />
        {statusInfo && (
          <div className="muted">
            활동 {statusInfo.activeDays.length}일 · AI 요약됨 {statusInfo.summarizedDays.length}일
          </div>
        )}
        <div className="grid2">
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => generatePeriod('daily')}
          >
            월간 요약 (일일 조합)
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => generatePeriod('raw')}
          >
            월간 요약 (원본에서)
          </button>
        </div>
        <button type="button" className="btn primary" disabled={busy !== null} onClick={generateReport}>
          {busy === 'report' ? '기안 초안 생성 중…' : '기안 초안 생성 (제출용)'}
        </button>
        {error && <div className="error">{error}</div>}
        {busy === 'period' && <Spinner label="월간 요약 생성 중…" />}
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
            <div className="muted">
              ⚠️ {period.end}까지만 반영된 요약입니다. 다시 생성하세요.
            </div>
          )}
          <div className="pre">{period.text}</div>
        </div>
      )}

      {report && profile && (
        <>
          <div className="card">
            <div className="row spread">
              <h3>기안 본문 미리보기</h3>
              <CopyButton text={report.text} label="본문 복사" primary />
            </div>
            <div className="pre">{report.text}</div>
          </div>

          <div className="card">
            <div className="row spread">
              <h3>엑셀 양식 미리보기</h3>
              <div className="row">
                <CopyButton text={report.excelTsv} label="표 복사" />
                <button type="button" className="btn primary" onClick={saveXlsx}>
                  엑셀 다운로드
                </button>
              </div>
            </div>
            <div className="scroll-x">
              <table className="excel">
                <thead>
                  <tr>
                    {EXCEL_HEADERS.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {profileToRow(profile).map((v, i) => (
                      <td key={i} className={v ? '' : 'empty'}>
                        {v || '(설정에서 입력)'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {savedPath && <div className="ok muted">저장됨: {savedPath}</div>}
            <div className="muted">
              미리보기와 동일한 내용이 .xlsx로 저장됩니다. 빈 칸은 설정 탭에서 채워주세요.
            </div>
          </div>

          <div className="card">
            <div className="row spread">
              <h3>사용 내역 증빙 ({report.appendix.length}건)</h3>
              <CopyButton text={report.appendix.join('\n')} label="증빙 복사" />
            </div>
            <div className="pre">{report.appendix.join('\n')}</div>
          </div>
        </>
      )}
    </>
  )
}
