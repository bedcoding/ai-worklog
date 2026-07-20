import ExcelJS from 'exceljs'
import { EXCEL_HEADERS, profileToRow } from '@shared/excel-format'
import type { Profile } from '@shared/types'

/**
 * 사내 엑셀 업로드 양식과 같은 구조(헤더 12컬럼 + 값 1행)의 .xlsx 파일을 만든다.
 * 미리보기(월간 탭의 표)와 완전히 동일한 내용이 저장된다.
 */
export async function writeReportXlsx(profile: Profile, filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow([...EXCEL_HEADERS])
  ws.addRow(profileToRow(profile))
  ws.getRow(1).font = { bold: true }
  EXCEL_HEADERS.forEach((h, i) => {
    const valueLen = profileToRow(profile)[i]?.length ?? 0
    ws.getColumn(i + 1).width = Math.min(50, Math.max(12, h.length * 2, valueLen + 4))
  })
  await wb.xlsx.writeFile(filePath)
}
