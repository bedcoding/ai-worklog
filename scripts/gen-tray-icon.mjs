// 트레이용 template PNG(흑색+알파)를 의존성 없이 생성한다.
// 실행: node scripts/gen-tray-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// 16x16 픽셀 아트: 문서(리스트) 모양. '#'=검정, '.'=투명
const ART = [
  '................',
  '..############..',
  '..#..........#..',
  '..#..........#..',
  '..#..######..#..',
  '..#..........#..',
  '..#..######..#..',
  '..#..........#..',
  '..#..######..#..',
  '..#..........#..',
  '..#......##..#..',
  '..#..........#..',
  '..############..',
  '................',
  '................',
  '................'
]

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, pixelAt) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4))
  let off = 0
  for (let y = 0; y < size; y++) {
    raw[off++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y)
      raw[off++] = r
      raw[off++] = g
      raw[off++] = b
      raw[off++] = a
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// 맥 트레이용: 검정+알파 template 이미지 (메뉴바가 라이트/다크에 맞춰 자동 반전한다)
function makeTrayPng(art, scale) {
  const size = art.length * scale
  return encodePng(size, (x, y) => {
    const on = art[Math.floor(y / scale)][Math.floor(x / scale)] === '#'
    return [0, 0, 0, on ? 255 : 0]
  })
}

// 윈도우 트레이용: 라운드 파랑 타일 + 흰 글리프.
// 윈도우는 template 이미지를 지원하지 않아(setTemplateImage가 no-op) 단색 검정 아이콘은
// 다크 작업표시줄에서 명암비 1.29:1로 사실상 안 보인다. 관례대로 브랜드 컬러를 쓴다.
// 정수 배율(16/32/48)만 만든다 — Electron은 @1.75x 같은 접미사를 인식하지 않는다.
function makeWinTrayPng(scale) {
  const size = ART.length * scale
  const radius = Math.max(2, Math.round(size * 0.2))
  const bg = [79, 110, 247] // #4f6ef7 — 라이트 3.63:1, 다크 4.04:1 (둘 다 3:1 통과)
  return encodePng(size, (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - 1 - radius)
    const cy = Math.min(Math.max(y, radius), size - 1 - radius)
    if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) return [0, 0, 0, 0]
    const on = ART[Math.floor(y / scale)][Math.floor(x / scale)] === '#'
    return on ? [255, 255, 255, 255] : [...bg, 255]
  })
}

// 앱 아이콘용(512px): 라운드 사각 파랑 배경 + 흰색 문서 아트
function makeAppIconPng() {
  const size = 512
  const margin = Math.round(size * 0.09)
  const radius = Math.round(size * 0.18)
  const bg = [79, 110, 247] // #4f6ef7
  const artScale = (size - margin * 4) / ART.length
  const artOffset = margin * 2
  return encodePng(size, (x, y) => {
    const inX = x >= margin && x < size - margin
    const inY = y >= margin && y < size - margin
    if (!inX || !inY) return [0, 0, 0, 0]
    // 라운드 코너: 코너 원 밖이면 투명
    const cx = Math.min(Math.max(x, margin + radius), size - margin - radius)
    const cy = Math.min(Math.max(y, margin + radius), size - margin - radius)
    if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) return [0, 0, 0, 0]
    const ax = Math.floor((x - artOffset) / artScale)
    const ay = Math.floor((y - artOffset) / artScale)
    if (ART[ay]?.[ax] === '#') return [255, 255, 255, 255]
    return [...bg, 255]
  })
}

mkdirSync(join(ROOT, 'resources'), { recursive: true })
// 맥 트레이
writeFileSync(join(ROOT, 'resources', 'iconTemplate.png'), makeTrayPng(ART, 1))
writeFileSync(join(ROOT, 'resources', 'iconTemplate@2x.png'), makeTrayPng(ART, 2))
// 윈도우 트레이 (Electron이 @2x/@3x를 자동 수집한다)
writeFileSync(join(ROOT, 'resources', 'trayIcon.png'), makeWinTrayPng(1))
writeFileSync(join(ROOT, 'resources', 'trayIcon@2x.png'), makeWinTrayPng(2))
writeFileSync(join(ROOT, 'resources', 'trayIcon@3x.png'), makeWinTrayPng(3))
// 앱 아이콘 — 512px 고정. electron-builder가 이 PNG에서 .ico를 자동 생성하며
// 256px 미만으로 줄이면 ERR_ICON_TOO_SMALL로 윈도우 빌드가 실패한다. 크기를 바꾸지 말 것.
writeFileSync(join(ROOT, 'resources', 'icon.png'), makeAppIconPng())
console.log('resources/ 아이콘 생성 완료 (mac template 2종, win tray 3종, app icon 1종)')
