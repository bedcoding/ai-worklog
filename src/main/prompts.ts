import type { PromptTemplates } from '@shared/types'

/**
 * 기본 프롬프트 템플릿. 사용자는 설정 탭에서 자유롭게 수정할 수 있고
 * "기본값 복원"으로 되돌릴 수 있다. {변수}는 실행 시 치환된다.
 */
export const DEFAULT_PROMPTS: PromptTemplates = {
  day: `당신은 개발자의 업무 일지를 정리하는 비서입니다.
아래 <데이터>는 개발자가 {date}({weekday}, KST)에 Claude Code(AI 코딩 도구)에 입력한
프롬프트와 프로젝트/브랜치 활동 기록입니다.

규칙:
- 데이터에 실제로 있는 작업만 기술하고, 추측하지 마세요.
- 회사 보고용 문어체로, 코드 조각·파일 경로·내부 식별자는 쓰지 말고 업무 단위로 일반화하세요.
- 프로젝트별로 묶고, 비슷한 반복 작업은 하나로 합치세요.
- 아래 JSON 스키마 그대로, JSON 외의 텍스트 없이 출력하세요.

{"headline": "하루 업무 한 줄 요약 (40자 이내)", "items": [{"project": "프로젝트명", "work": "수행 업무 (명사형 종결, 60자 이내)"}], "keywords": ["핵심 키워드 3~5개"]}

<데이터>
{digest}
</데이터>`,

  period: `아래 <데이터>는 {label} 동안 Claude Code(AI 코딩 도구)로 수행한 업무 기록입니다.
회사 보고용 업무 요약을 작성하세요.

규칙:
- 데이터에 실제로 있는 작업만 기술하고, 추측하지 마세요.
- 프로젝트별로 묶어 마크다운 불릿으로 정리하고, 마지막에 한 줄 총평을 붙이세요.
- 코드 조각·파일 경로·내부 식별자 대신 업무 단위로 일반화하세요.

<데이터>
{data}
</데이터>`
}

/**
 * {word} 형태 플레이스홀더만 치환한다.
 * 템플릿 안의 JSON 예시({"headline": ...})는 따옴표 때문에 \w+에 매칭되지 않아 안전.
 */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? vars[key] : m))
}
