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

// 트레이용: 검정+알파 template 이미지
function makeTrayPng(art, scale) {
  const size = art.length * scale
  return encodePng(size, (x, y) => {
    const on = art[Math.floor(y / scale)][Math.floor(x / scale)] === '#'
    return [0, 0, 0, on ? 255 : 0]
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
writeFileSync(join(ROOT, 'resources', 'iconTemplate.png'), makeTrayPng(ART, 1))
writeFileSync(join(ROOT, 'resources', 'iconTemplate@2x.png'), makeTrayPng(ART, 2))
writeFileSync(join(ROOT, 'resources', 'icon.png'), makeAppIconPng())
console.log('resources/iconTemplate.png, iconTemplate@2x.png, icon.png 생성 완료')
