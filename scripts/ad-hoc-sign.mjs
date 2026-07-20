// Apple Developer 인증서 없이도 번들이 유효한 서명 구조를 갖도록 ad-hoc 서명한다.
// 재서명하지 않으면 Electron 헬퍼들의 원본 서명이 깨진 상태로 남아 실행이 거부될 수 있다.
// electron-builder afterPack 훅.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export default async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log(`ad-hoc 서명 완료: ${appPath}`)
}
