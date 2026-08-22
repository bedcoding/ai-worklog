# WorkLog

**Claude Code 사용 내역으로 일일 업무 요약과 월간 제출 서류를 자동 생성하는 macOS·Windows 트레이 앱**

회사에서 "외부 AI 도구를 쓰면 매달 사용 내역을 보고하라"고 하나요?
Claude Code는 모든 대화를 이미 내 PC에 기록하고 있습니다. WorkLog는 그 로컬 기록을 읽어
트레이(맥은 메뉴바)에서 클릭 한 번으로 아래를 만들어 줍니다.

- **일일 요약** — "오늘 하루 정리하기" 클릭 → 오늘 어떤 프로젝트에서 무슨 작업을 했는지 요약
- **주간/월간 요약** — 일별 요약을 조합하거나, 원본 대화 기록에서 통째로 생성
- **월간 제출 서류** — 기안 본문(사용 목적/예상 업무 결과물 자동 작성) + 사내 엑셀 양식(.xlsx) 다운로드 + 일자별 증빙 목록

## 특징

- **API 비용 없음** — 요약은 내 PC에 설치된 `claude` CLI를 그대로 호출합니다 (구독 쿼터 사용, 별도 API 과금 없음)
- **토큰 없이도 사용 가능** — "원본 내역" 탭은 AI 호출 없이 로컬 로그 파싱만으로 날짜별 작업 내역을 보여줍니다
- **매일 자동 실행** — 지정 시각에 오늘 요약을 자동 생성 (끄기 / 물어보고 실행 / 조용히 실행)
- **캐시 우선** — 한 번 요약한 날짜는 다시 요약하지 않습니다. 월말에 몰아서 눌러도 미요약 날짜만 순차 백필
- **프롬프트 커스텀** — 요약 프롬프트 3종을 설정 탭에서 자유롭게 수정
- **자동 정리** — 오래된 원본 추출 캐시는 보관 기간(기본 12개월)이 지나면 자동 삭제

## 프라이버시 (중요)

이 앱은 회사 보고용 도구인 만큼, 스스로도 감사 가능하게 만들었습니다.

1. **앱 자체는 네트워크 호출이 0건입니다.** `src/`에 네트워크 코드가 없음을 CI가 강제합니다
   (`scripts/check-no-network.mjs`, 릴리스마다 실행).
2. **유일한 외부 프로세스는 로컬 `claude` CLI** — 이미 회사에 보고하는 바로 그 도구입니다.
   요약을 위해 전달되는 것은 "내가 이미 Claude Code에 입력했던 프롬프트"의 절단본뿐입니다.
   `--no-session-persistence`로 실행되어 이 요약 작업 자체는 대화 기록에 남지 않습니다.
3. **원본 로그는 읽기 전용** — 이 앱은 원본 로그를 읽기만 하고 수정·삭제하지 않습니다.
   (앱이 호출하는 `claude` CLI가 전용 작업 디렉토리에 해당하는 빈 프로젝트 폴더를 만들 수는 있지만,
   대화 내용은 기록되지 않습니다.)
   생성물은 앱 데이터 디렉토리에만 저장됩니다 —
   macOS: `~/Library/Application Support/ai-worklog/`, Windows: `%APPDATA%\ai-worklog\`
4. **생성된 보고서에는 원본 프롬프트·코드·도구 출력이 포함되지 않습니다** — 업무 단위로
   일반화된 요약만 담깁니다. (도구 출력(tool_result)은 아예 파싱 단계에서 버려집니다)
5. **최소 의존성** — 런타임 의존성은 `react`, `react-dom`, `exceljs` 3개뿐이고, 릴리스 바이너리는
   공개 GitHub Actions에서 태그 커밋으로부터 빌드됩니다.

## 설치

요구 사항: [Claude Code](https://claude.com/claude-code) CLI가 설치되어 있어야 합니다
(`claude --version`이 동작하면 OK — 경로가 특이하면 설정 탭에서 직접 지정).

### macOS

1. [Releases](https://github.com/bedcoding/ai-worklog/releases)에서 `.dmg`(또는 `.zip`) 다운로드
2. 앱을 Applications로 드래그
3. **첫 실행**: 서명되지 않은 앱이므로 우클릭 → "열기"로 실행하거나, 터미널에서:
   ```bash
   xattr -cr /Applications/WorkLog.app
   ```
   macOS 15+에서는 시스템 설정 → 개인정보 보호 및 보안 → "확인 없이 열기"가 필요할 수 있습니다.
4. 메뉴바의 문서 아이콘 클릭 → 설정 탭에서 제출 양식 프로필 입력

### Windows

1. [Releases](https://github.com/bedcoding/ai-worklog/releases)에서 `WorkLog-Setup-<버전>-x64.exe` 다운로드
2. 브라우저가 "일반적으로 다운로드되지 않는 파일"이라고 하면 → **유지**
3. 실행하면 "Windows에서 PC를 보호했습니다" 창이 뜹니다 → **추가 정보** → **실행**
   (서명 인증서 없이 배포하기 때문입니다. PowerShell을 선호하면 실행 전에
   `Unblock-File .\WorkLog-Setup-<버전>-x64.exe`)
4. 설치 마법사가 순서대로 묻습니다:
   - **설치 대상** — 기본값 "현재 사용자만" 권장. "모든 사용자"를 고르면 관리자 권한(UAC)을
     요청하고 설치 경로가 바뀝니다. 자동 시작을 쓸 거면 기본값이 안전합니다.
   - **설치 폴더** — 기본값 `%LOCALAPPDATA%\Programs\WorkLog`
5. 설치가 끝나면 앱이 자동 실행되지만 **작업표시줄에는 아이콘이 생기지 않습니다** —
   상주 앱이라 알림 영역(시계 왼쪽 `^`)에 있습니다. 처음에는 숨겨져 있으니
   `^`를 눌러 문서 아이콘을 찾아 작업표시줄로 끌어다 고정해 두세요.
6. 아이콘 클릭 → 설정 탭에서 제출 양식 프로필 입력

> claude 경로를 직접 지정해야 하면 `where.exe claude`로 확인하세요.
> `.cmd`·`.ps1`·확장자 없는 셰임 경로를 넣어도 앱이 실제 실행 파일로 해석합니다.

## 사용법

| 탭 | 하는 일 |
|---|---|
| 일일 | 날짜별 요약 목록. 날짜를 펼치면 [AI 요약 / 원본 내역] 확인, 미요약 날짜는 그 자리에서 생성 |
| 주간 | [일일 요약 조합] 또는 [원본 대화에서] 주간 업무 요약 생성 → 복사 |
| 월간 기안 | 월간 요약 + **기안 초안 생성**: 본문 복사, 엑셀 양식 미리보기 → 표 복사(TSV) / .xlsx 다운로드, 증빙 목록 복사 |
| 설정 | 양식 프로필(고정값), claude 경로/모델, 매일 자동 실행, 보관 기간, 프롬프트 템플릿 |

창은 다른 곳을 클릭하면 자동으로 닫힙니다. 탭 오른쪽의 **압정 버튼**을 누르면 고정되어
포커스를 옮겨도 닫히지 않습니다(고정 중에는 항상 위에 표시). 기울어진 압정 = 해제,
똑바로 선 압정 = 고정이며, 앱을 다시 켜면 해제 상태로 돌아갑니다.

## 개발

```bash
npm install
npm run dev        # HMR 개발 모드
npm run dev:show   # 기동 즉시 창을 띄우고 고정한 채 개발 (트레이 아이콘을 찾지 않아도 됨)
npm test           # 단위 테스트
npm run build      # 타입체크 + 프로덕션 빌드
npm run icons      # resources/ 아이콘 재생성
npm run dist       # 현재 OS용 패키징 (unsigned)
npm run dist:mac   # .dmg/.zip
npm run dist:win   # NSIS 설치 파일 (.exe)
```

기술 스택: Electron + React + TypeScript (electron-vite), 트레이 직접 구현, 저장은 로컬 JSON.

> 참고: main/preload는 CJS로 빌드합니다(electron-vite 기본값). 또한 셸에 `ELECTRON_RUN_AS_NODE=1`이
> 설정돼 있으면 Electron이 GUI 대신 Node로 실행되어 앱이 즉시 종료됩니다 — 일부 에디터 터미널에
> 이 변수가 설정돼 있으니, 앱이 뜨지 않으면 먼저 확인하세요
> (macOS/Linux: `env | grep ELECTRON`, Windows PowerShell: `Get-ChildItem Env:ELECTRON*`).

### 동작 원리

```
Claude Code가 이미 기록 중인 대화 로그 (읽기 전용)
  macOS   ~/.claude/projects/<프로젝트>/*.jsonl
  Windows C:\Users\<사용자>\.claude\projects\<프로젝트>\*.jsonl
        │  mtime 필터 + 스트리밍 파싱, KST 날짜별 분류
        ▼
일별 다이제스트 (원본 추출, AI 호출 없음 · 캐시)
        │  claude -p --no-session-persistence  (로컬 CLI, 구독 쿼터)
        ▼
일별 AI 요약 (캐시, 같은 내용은 재요약 안 함)
        │  조합
        ▼
주간/월간 요약 · 월간 기안 (본문 + 엑셀 .xlsx + 증빙 목록)
```

## License

MIT
