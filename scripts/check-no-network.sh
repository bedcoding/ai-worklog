#!/usr/bin/env bash
# 프라이버시 보증: 앱 소스에 네트워크 호출 코드가 없음을 CI에서 강제한다.
# (이 앱이 실행하는 유일한 외부 프로세스는 로컬 claude CLI뿐이다)
set -euo pipefail
cd "$(dirname "$0")/.."

PATTERN='fetch\(|XMLHttpRequest|WebSocket\(|require\(.node:https?.\)|from .node:https?.|net\.connect|axios|new Request\('

if grep -RnE "$PATTERN" src/; then
  echo "❌ src/ 에서 네트워크 호출로 보이는 코드가 발견되었습니다." >&2
  exit 1
fi
echo "✓ 네트워크 호출 없음 확인"
