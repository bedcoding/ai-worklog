// 프라이버시 보증: 앱 소스에 네트워크 호출 코드가 없음을 CI에서 강제한다.
// (이 앱이 실행하는 유일한 외부 프로세스는 로컬 claude CLI뿐이다)
//
// 예외는 update-check.ts 하나다. 최신 릴리스 버전을 묻는 GET 요청만 있고 보내는
// 데이터가 없다. 예외를 한 파일로 묶어야 "무엇이 밖으로 나가는가"를 그 파일만 읽고
// 판단할 수 있다. 그 파일도 그냥 넘기지 않고, 허용한 호스트만 쓰는지 따로 본다.
//
// bash/grep 의존을 없애고 node로 재작성했다 — 윈도우에서 `bash`는 Git Bash가 아니라
// System32\bash.exe(WSL 런처)로 해석되어 WSL 배포가 없으면 실패한다.
// 실행: node scripts/check-no-network.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

const PATTERN =
  /fetch\(|XMLHttpRequest|WebSocket\(|require\(.node:https?.\)|from .node:https?.|net\.connect|axios|new Request\(/

/** 네트워크를 써도 되는 파일과, 그 파일이 접근해도 되는 호스트 */
const ALLOWED = {
  'src/main/update-check.ts': [
    'https://api.github.com/repos/bedcoding/ai-worklog/releases/latest',
    'https://github.com/bedcoding/ai-worklog/releases/latest'
  ]
}

const hits = []
const allowViolations = []

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(p)
      continue
    }
    if (!entry.isFile()) continue
    // CRLF 체크아웃에서도 동일하게 동작하도록 \r?\n 으로 자른다
    const lines = readFileSync(p, 'utf8').split(/\r?\n/)
    const rel = relative(ROOT, p).replace(/\\/g, '/')
    const allowedUrls = ALLOWED[rel]
    if (allowedUrls) {
      // 예외 파일은 호출 자체를 허용하되, 적힌 주소가 허용 목록 안인지 본다
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/https?:\/\/[^\s'"`]+/g)) {
          if (!allowedUrls.includes(m[0])) {
            allowViolations.push(`${rel}:${i + 1}: 허용되지 않은 주소 ${m[0]}`)
          }
        }
      })
      return
    }
    lines.forEach((line, i) => {
      if (PATTERN.test(line)) {
        hits.push(`${rel}:${i + 1}: ${line.trim()}`)
      }
    })
  }
}

walk(SRC)

if (hits.length > 0) {
  console.error('[X] src/ 에서 네트워크 호출로 보이는 코드가 발견되었습니다.')
  for (const h of hits) console.error(`  ${h}`)
  process.exit(1)
}
if (allowViolations.length > 0) {
  console.error('[X] 예외 파일이 허용 목록 밖의 주소를 씁니다.')
  for (const v of allowViolations) console.error(`  ${v}`)
  process.exit(1)
}
const exceptions = Object.keys(ALLOWED)
console.log(`[OK] 네트워크 호출 없음 확인 (예외 ${exceptions.length}곳: ${exceptions.join(', ')})`)
