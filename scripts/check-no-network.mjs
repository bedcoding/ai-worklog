// 프라이버시 보증: 앱 소스에 네트워크 호출 코드가 없음을 CI에서 강제한다.
// (이 앱이 실행하는 유일한 외부 프로세스는 로컬 claude CLI뿐이다)
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

const hits = []

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
    lines.forEach((line, i) => {
      if (PATTERN.test(line)) {
        hits.push(`${relative(ROOT, p).replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`)
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
console.log('[OK] 네트워크 호출 없음 확인')
