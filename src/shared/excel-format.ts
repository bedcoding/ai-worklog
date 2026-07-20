import type { Profile } from './types'

/** 사내 "회사 표준 AI 도구 신청" 엑셀 양식의 12컬럼 (순서 고정) */
export const EXCEL_HEADERS = [
  '기안제목',
  '기안링크',
  '기안승인일',
  '법인',
  '소속',
  '이름',
  '사번',
  '회사메일',
  '사용중인AI서비스',
  '구독플랜',
  '결제주기',
  '금액(현지통화)'
] as const

/** 양식 컬럼 순서대로 프로필 값을 배열로 */
export function profileToRow(p: Profile): string[] {
  return [
    p.gianTitle,
    p.gianLink,
    p.gianApprovedDate,
    p.corp,
    p.dept,
    p.name,
    p.empNo,
    p.email,
    p.aiService,
    p.plan,
    p.billingCycle,
    p.amount
  ]
}
