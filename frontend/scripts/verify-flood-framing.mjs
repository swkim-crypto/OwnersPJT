// ══════════════════════════════════════════════════════
//  verify-flood-framing.mjs — 브라우저 없이 카메라 역산 검증
//
//    node scripts/verify-flood-framing.mjs
//    node scripts/verify-flood-framing.mjs --aspect 1.6 --fraction 0.33
//
//  로컬 dev 서버를 안 쓰는 워크플로라 브라우저 확인 전에
//  숫자만이라도 먼저 맞는지 보려고 둡니다. Cesium 을 import 하지 않으므로
//  순수 Node 로 돕니다 (floodGeom.js 가 Cesium 무의존인 이유).
// ══════════════════════════════════════════════════════
import { FLOOD_POLYGONS } from '../src/data/floodPolygons.js'
import { RIVER_DAMS } from '../src/data/riverData.js'
import { computeFloodView, enuOffset } from '../src/flight/floodGeom.js'

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k)
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : d
}
const ASPECTS = process.argv.includes('--aspect')
  ? [arg('aspect', 16 / 9)]
  : [2.222, 1.6, 0.75]           // 와이드 데스크톱 · 노트북 · 세로 모바일
const FRACTION = arg('fraction', 1 / 3)
const PITCH = arg('pitch', -38)

const damById = Object.fromEntries(RIVER_DAMS.map(d => [d.id, d]))

let n = 0, clamped = 0, worst = 0, fail = 0

for (const aspect of ASPECTS) {
  console.log(`\n===== aspect ${aspect.toFixed(3)} · fraction ${FRACTION.toFixed(3)} · pitch ${PITCH}° =====`)
  for (const [id, rec] of Object.entries(FLOOD_POLYGONS)) {
    const cells = []
    for (const H of rec.heights) {
      const b = rec.byHeight[String(H)]
      if (!b) continue
      const dam = damById[id]
      const v = computeFloodView({
        rings: b.rings, bbox: b.bbox,
        dam: dam ? { lon: dam.lon, lat: dam.lat } : null,
        fsl: b.fsl, damHeight: H,
        aspect, fraction: FRACTION, pitchDeg: PITCH,
      })
      n++
      const cover = Math.max(v.coverX, v.coverY)
      if (v.clamped) clamped++
      else worst = Math.max(worst, Math.abs(cover - FRACTION))

      // 카메라가 수면보다 위에 있어야 한다
      const up = enuOffset(v.headingDeg, v.pitchDeg, v.range).up
      if (!(up > 0)) { console.error(`  ✘ ${id} H=${H}: 카메라가 수면 아래`); fail++ }
      if (!Number.isFinite(v.range) || v.range <= 0) { console.error(`  ✘ ${id} H=${H}: range 비정상`); fail++ }

      cells.push(`${H}:${Math.round(v.range)}${v.mode === 'broadside' ? 'B' : 'A'}${v.clamped ? '*' : ''}`)
    }
    console.log('  ' + id.padEnd(11) + cells.join(' '))
  }
}

console.log(`\n표기: 댐고:카메라거리(m) A=축선 B=측면 *=최소거리 클램프`)
console.log(`표본 ${n} · 클램프 ${clamped} · 최대 |점유율-목표| = ${worst.toExponential(2)}`)
if (fail) { console.error(`\n✘ 실패 ${fail}건`); process.exit(1) }
console.log('✓ 이상 없음')
