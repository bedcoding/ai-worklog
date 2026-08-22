// 트레이 앱 디버깅용: 기동 즉시 창을 띄우고 고정(핀)한 채 dev 서버를 실행한다.
// 트레이 상주 앱은 창을 보려면 아이콘을 찾아 클릭해야 하는데, 윈도우 11은 새 트레이
// 아이콘을 오버플로(^)에 숨기므로 두 번 클릭해야 한다.
// 고정 상태로 시작하므로 에디터로 포커스를 옮겨도 창이 닫히지 않는다 (탭바의 핀 버튼으로 해제).
//
// PowerShell에는 `VAR=1 명령` 형태의 인라인 환경변수 지정이 없어서 스크립트로 감싼다.
// 직접 쓰려면: $env:WORKLOG_SHOW_ON_START=1; npm run dev
// 실행: npm run dev:show
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_VITE = join(ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

spawn(process.execPath, [ELECTRON_VITE, 'dev'], {
  stdio: 'inherit',
  env: { ...process.env, WORKLOG_SHOW_ON_START: '1' }
}).on('exit', (code) => process.exit(code ?? 0))
