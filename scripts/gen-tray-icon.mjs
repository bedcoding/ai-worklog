// 트레이·앱 아이콘을 의존성 없이 생성한다.
// 실행: node scripts/gen-tray-icon.mjs  (npm run icons)
//
// 도형 정의는 하나뿐이고(문서 실루엣 + 무표정 얼굴) 표현만 셋으로 나뉜다.
//   template : 외곽선 + 투명 배경, 검정 단색   -> 맥 메뉴바 (OS가 라이트/다크 자동 반전)
//   solid    : 채운 실루엣 + 얼굴 구멍 + 흰 헤일로 -> 윈도우 트레이
//   badge    : 검정 원 + 흰 외곽선 문서         -> 앱 아이콘 (양 플랫폼)
//
// 윈도우가 별도 표현을 쓰는 이유: setTemplateImage는 맥 전용이라 윈도우에서 no-op이고,
// 검정 단색 아이콘은 다크 작업표시줄에서 명암비 1.29:1로 사실상 보이지 않는다.
// 원형 배지를 트레이에 재사용하는 방안은 16px에서 원이 공간을 다 먹어 문서가
// 흰 점이 되므로 쓰지 않는다. 헤일로 방식은 파일 하나로 양쪽 테마를 커버한다.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ---------------- PNG 인코더 ---------------- */
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

/* ---------------- 도형: 문서 + 무표정 얼굴 ---------------- */
/**
 * 비율은 16px에서 픽셀이 깨지지 않도록 맞춰져 있다. 특히 CUT(접힌 모서리 크기)을
 * 키우면 대각선이 눈 높이까지 내려와 오른쪽 눈이 테두리와 한 덩어리로 붙는다.
 */
const INSET_X = 0.17 // 문서 좌우 여백 (박스 기준)
const INSET_Y = 0.06 // 문서 상하 여백
const CUT = 0.28 // 우상단 접힌 모서리 — 사각형을 '종이'로 읽히게 하는 요소
const STROKE = 20 // 선 두께 = box / STROKE
const EYE = 7 // 눈 크기 = box / EYE
const EYE_GAP = 0.13 // 두 눈 좌우 간격 (박스 기준)
const MOUTH_W = 0.28
const MOUTH_H = 18 // 입 두께 = box / MOUTH_H
// 눈·입 높이는 '눈-입 수직 간격 = 눈 높이'가 되도록 맞춘 값이다.
// 16/24/32/48px 에서 각각 2:2, 3:3, 4:4, 6:6 으로 떨어진다.
// MOUTH_Y 를 0.69 미만으로 내리면 16px 에서 반올림 때문에 간격이 1px 로 줄어 눈과 입이 붙는다.
const EYE_Y = 0.34 // 눈 높이 (문서 높이 기준)
const MOUTH_Y = 0.69

function docShape(originX, originY, box) {
  const sw = Math.max(1, Math.round(box / STROKE))
  const left = originX + Math.round(box * INSET_X)
  const right = originX + box - 1 - Math.round(box * INSET_X)
  const top = originY + Math.round(box * INSET_Y)
  const bot = originY + box - 1 - Math.round(box * INSET_Y)
  const cut = Math.round((right - left) * CUT)

  const inside = (x, y) => {
    if (x < left || x > right || y < top || y > bot) return false
    if (cut > 0 && x - left > right - left - cut && y - top < cut) {
      return x - (right - cut) <= y - top // 접힌 모서리의 대각선 아래쪽만 남긴다
    }
    return true
  }

  const isEdge = (x, y) => {
    if (!inside(x, y)) return false
    for (let dy = -sw; dy <= sw; dy++) {
      for (let dx = -sw; dx <= sw; dx++) if (!inside(x + dx, y + dy)) return true
    }
    return false
  }

  const eye = Math.max(1, Math.round(box / EYE))
  const eyeY = top + Math.round((bot - top) * EYE_Y)
  const gap = Math.max(1, Math.round(box * EYE_GAP))
  const cx = Math.round((left + right) / 2)
  const eyeL = Math.round(cx - gap / 2 - eye)
  const eyeR = Math.round(cx + gap / 2)
  const mouthW = Math.max(2, Math.round(box * MOUTH_W))
  const mouthH = Math.max(1, Math.round(box / MOUTH_H))
  const mouthY = top + Math.round((bot - top) * MOUTH_Y)
  // floor로 잡아야 좁은 내부 폭에서 좌우 여백이 대칭이 된다
  const mouthX = cx - Math.floor(mouthW / 2)

  const inFace = (x, y) => {
    if (
      y >= eyeY &&
      y < eyeY + eye &&
      ((x >= eyeL && x < eyeL + eye) || (x >= eyeR && x < eyeR + eye))
    ) {
      return true
    }
    return y >= mouthY && y < mouthY + mouthH && x >= mouthX && x < mouthX + mouthW
  }

  return { inside, isEdge, inFace }
}

const TRANSPARENT = [0, 0, 0, 0]
const BLACK = [17, 17, 17, 255]
const WHITE = [255, 255, 255, 255]

/** 맥 메뉴바용 template — 검정 외곽선 + 얼굴, 배경 투명 */
function makeTemplatePng(size) {
  const s = docShape(0, 0, size)
  return encodePng(size, (x, y) => (s.isEdge(x, y) || s.inFace(x, y) ? BLACK : TRANSPARENT))
}

/**
 * 윈도우 트레이용 — 채운 검정 실루엣 + 흰 얼굴 + 흰 헤일로.
 * 라이트 작업표시줄에서는 검정 본체가, 다크에서는 흰 헤일로가 형태를 잡는다.
 */
function makeTrayPng(size) {
  const halo = Math.max(1, Math.round(size / 16))
  const s = docShape(halo, halo, size - halo * 2)
  const nearInside = (x, y) => {
    for (let dy = -halo; dy <= halo; dy++) {
      for (let dx = -halo; dx <= halo; dx++) if (s.inside(x + dx, y + dy)) return true
    }
    return false
  }
  return encodePng(size, (x, y) => {
    if (s.inside(x, y)) return s.inFace(x, y) ? WHITE : BLACK
    return nearInside(x, y) ? WHITE : TRANSPARENT
  })
}

/** 앱 아이콘 — 검정 원 + 흰 외곽선 문서 (todo-alarm 과 같은 틀) */
function makeAppIconPng(size) {
  const box = Math.round(size * 0.54)
  const off = Math.round((size - box) / 2)
  const s = docShape(off, off, box)
  const r = size / 2 - 0.5
  return encodePng(size, (x, y) => {
    const dx = x - size / 2 + 0.5
    const dy = y - size / 2 + 0.5
    if (dx * dx + dy * dy > r * r) return TRANSPARENT
    return s.isEdge(x, y) || s.inFace(x, y) ? WHITE : BLACK
  })
}

/* ---------------- .ico 패킹 ---------------- */
/**
 * PNG 프레임들을 .ico 컨테이너로 묶는다 (PNG-in-ICO, Windows Vista+).
 *
 * electron-builder에 512px PNG만 주면 16~256px를 bicubic으로 축소해 넣는데,
 * 작은 프레임이 회색 덩어리로 뭉개진다. 크기별로 직접 찍은 프레임을 넣어 그것을 피한다.
 * electron-builder는 ICONDIR을 파싱해 최대 프레임이 256 미만이면 빌드를 실패시키므로
 * 256 프레임이 반드시 있어야 한다.
 */
function packIco(frames) {
  const count = frames.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  frames.forEach(({ size, png }, i) => {
    const o = i * 16
    dir[o] = size >= 256 ? 0 : size // 0 = 256px
    dir[o + 1] = size >= 256 ? 0 : size
    dir[o + 2] = 0 // 팔레트 색 수 (트루컬러는 0)
    dir[o + 3] = 0 // reserved
    dir.writeUInt16LE(1, o + 4) // color planes
    dir.writeUInt16LE(32, o + 6) // bits per pixel
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })

  return Buffer.concat([header, dir, ...frames.map((f) => f.png)])
}

/**
 * 앱 아이콘 프레임 — 크기에 따라 표현을 바꾼다.
 * 원형 배지는 48px 미만에서 원이 공간을 다 먹어 문서가 흰 점이 된다(실측).
 * 배지 안쪽 문서를 키우는 방향도 시험했지만 외곽선이 깨져 더 나빠졌다.
 * 그래서 작은 프레임은 원을 빼고 트레이와 같은 solid 표현을 쓴다 — 문서 실루엣과
 * 얼굴은 그대로이므로 정체성은 유지된다.
 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const appIconFrame = (size) => (size < 48 ? makeTrayPng(size) : makeAppIconPng(size))

/* ---------------- 출력 ---------------- */
const out = (name) => join(ROOT, 'resources', name)
mkdirSync(join(ROOT, 'resources'), { recursive: true })

// 맥 메뉴바 (Electron이 @2x를 자동 수집한다)
writeFileSync(out('iconTemplate.png'), makeTemplatePng(16))
writeFileSync(out('iconTemplate@2x.png'), makeTemplatePng(32))
// 윈도우 트레이 — 정수 배율만 만든다 (Electron은 @1.75x 같은 접미사를 인식하지 않는다)
writeFileSync(out('trayIcon.png'), makeTrayPng(16))
writeFileSync(out('trayIcon@2x.png'), makeTrayPng(32))
writeFileSync(out('trayIcon@3x.png'), makeTrayPng(48))
// 앱 아이콘 — 512px 고정. electron-builder가 이 PNG에서 맥 .icns를 만들며
// 256px 미만으로 줄이면 ERR_ICON_TOO_SMALL로 빌드가 즉시 실패한다.
writeFileSync(out('icon.png'), makeAppIconPng(512))
// 윈도우 앱 아이콘 — 크기별로 직접 찍은 프레임을 담은 .ico
writeFileSync(
  out('icon.ico'),
  packIco(ICO_SIZES.map((size) => ({ size, png: appIconFrame(size) })))
)

console.log(
  `resources/ 아이콘 생성 완료 (mac template 2종, win tray 3종, app icon png + ico ${ICO_SIZES.length}프레임)`
)
