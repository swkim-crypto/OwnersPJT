// ══════════════════════════════════════════════════════
//  floodGeom.js — 수몰면 → 카메라 프레이밍 역산 (순수 JS · Cesium 의존 없음)
//
//  왜 순수 모듈인가
//  · Cesium 을 import 하면 Node 에서 검증할 수 없습니다.
//    1단계에서 riverDerived.js 를 Node 로 돌려 heading 버그를 잡았듯이,
//    이 모듈도 실제 floodPolygons.js 를 넣고 Node 로 커버리지를 확인합니다.
//  · Cesium 호출은 floodCamera.js 가 담당.
//
//  핵심 요구: "수몰지구가 화면 1/3"
//    상부댐 bbox 38~630 m / 하부댐 250~4,956 m — 100배 차이.
//    고정 거리 불가 → FOV·종횡비·피치를 모두 넣어 거리를 역산합니다.
// ══════════════════════════════════════════════════════

export const M_PER_DEG_LAT = 110540

export function mPerDegLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180)
}

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

/**
 * Cesium PerspectiveFrustum 규약:
 *   aspect > 1 이면 fov 는 수평, 아니면 수직.
 * 항상 수직 FOV(fovy) 로 환산해서 돌려줍니다.
 */
export function toFovy(fov, aspect) {
  if (!(aspect > 0)) return fov
  return aspect > 1 ? 2 * Math.atan(Math.tan(fov / 2) / aspect) : fov
}

/** rings( [[ [lon,lat], ... ], ... ] ) 를 평탄화. 없으면 bbox 네 귀퉁이. */
export function collectPoints(rings, bbox) {
  const pts = []
  if (Array.isArray(rings)) {
    for (const r of rings) {
      if (!Array.isArray(r)) continue
      for (const p of r) {
        if (Array.isArray(p) && p.length >= 2) pts.push(p)
      }
    }
  }
  if (pts.length === 0 && Array.isArray(bbox) && bbox.length === 4) {
    const [w, s, e, n] = bbox
    pts.push([w, s], [e, s], [e, n], [w, n])
  }
  return pts
}

/**
 * 수몰면 기하 요약.
 * @returns {{lon0,lat0,count,alongM,acrossM,axisDeg,widthM,heightM}}
 *   axisDeg : 댐 → 수몰면 중심 방위각(북=0, 시계방향). 저수지가 뻗어나가는 방향.
 *   alongM  : 그 축 방향 총 길이
 *   acrossM : 축에 직교하는 방향 총 폭
 *   midLon/midLat : 축 좌표계에서 잰 **범위의 한가운데**.
 *     정점 평균(lon0/lat0)이 아닙니다. 링 정점 수가 많은 쪽으로 평균이
 *     끌려가기 때문입니다. 상부(150점)+하부(800점) 페어에서는 평균이
 *     하부 쪽으로 쏠려, 거리는 둘을 덮어도 카메라가 하부를 겨눠
 *     상부가 화면 밖으로 밀려났습니다. 겨냥은 반드시 범위 중앙으로.
 */
export function floodExtent(rings, bbox, dam) {
  const pts = collectPoints(rings, bbox)
  if (pts.length === 0) throw new Error('floodExtent: 폴리곤 점이 없습니다')

  let sx = 0, sy = 0
  for (const p of pts) { sx += p[0]; sy += p[1] }
  const lon0 = sx / pts.length
  const lat0 = sy / pts.length

  const kx = mPerDegLon(lat0)
  const ky = M_PER_DEG_LAT
  const xy = pts.map(p => [(p[0] - lon0) * kx, (p[1] - lat0) * ky])

  // 축: 댐 → 중심. 댐이 중심과 겹치면 bbox 장축으로 대체.
  let ax = 0, ay = 1
  if (dam && Number.isFinite(dam.lon) && Number.isFinite(dam.lat)) {
    ax = (lon0 - dam.lon) * kx
    ay = (lat0 - dam.lat) * ky
  }
  let m = Math.hypot(ax, ay)
  if (m < 1e-6) {
    const [w, s, e, n] = bbox || [lon0, lat0, lon0, lat0]
    const W = (e - w) * kx, H = (n - s) * ky
    if (W >= H) { ax = 1; ay = 0 } else { ax = 0; ay = 1 }
    m = 1
  }
  ax /= m; ay /= m
  const rx = ay, ry = -ax          // 축의 오른쪽 직교 단위벡터

  let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity
  for (const [x, y] of xy) {
    const a = x * ax + y * ay
    const c = x * rx + y * ry
    if (a < a0) a0 = a; if (a > a1) a1 = a
    if (c < c0) c0 = c; if (c > c1) c1 = c
  }

  // 범위 중앙 — 축(a)·직교(c) 방향의 중점을 다시 경위도로
  const ma = (a0 + a1) / 2
  const mc = (c0 + c1) / 2
  const midX = ma * ax + mc * rx
  const midY = ma * ay + mc * ry

  const [w, s, e, n] = bbox || [lon0, lat0, lon0, lat0]
  return {
    lon0, lat0,
    midLon: lon0 + midX / kx,
    midLat: lat0 + midY / ky,
    count: pts.length,
    alongM: a1 - a0,
    acrossM: c1 - c0,
    axisDeg: (Math.atan2(ax, ay) * R2D + 360) % 360,
    widthM: (e - w) * kx,
    heightM: (n - s) * ky,
  }
}

/**
 * 수몰면이 화면의 `fraction` 을 차지하도록 카메라를 역산.
 *
 * @param {Object}  o
 * @param {Array}   o.rings        FLOOD_POLYGONS[id].byHeight[H].rings
 * @param {Array}   o.bbox         [w,s,e,n]
 * @param {Object}  o.dam          {lon,lat} — 댐 지점(수몰면의 하류 끝)
 * @param {number}  o.fsl          만수위 EL (m)
 * @param {number}  o.damHeight    댐고 H (m) — 수직 성분 프레이밍용
 * @param {number}  o.aspect       캔버스 가로/세로
 * @param {number} [o.fov]         Cesium camera.frustum.fov (rad, 기본 60°)
 * @param {number} [o.fovy]        알고 있으면 직접 전달 (rad)
 * @param {number} [o.fraction]    화면 점유율 (기본 1/3)
 * @param {number} [o.pitchDeg]    카메라 피치 (기본 -35)
 * @param {string} [o.mode]        'auto'(기본) | 'axis'(댐 뒤에서 저수지 바라보기) | 'broadside'(측면)
 *                                 auto = 두 모드를 다 풀어보고 더 가까이 붙는 쪽,
 *                                 즉 화면에 더 크게 잡히는 쪽을 고릅니다.
 * @param {number} [o.aimBias]     0=수몰면 중심을 겨냥, 1=댐을 겨냥 (기본 0.2)
 * @param {number} [o.rangeBoost]  거리에 더할 값(m). 상부댐 상대고도 보정용.
 *                                 상·하부를 똑같이 화면 1/3 로 맞추면 둘이 같은
 *                                 크기로 보여 규모 차이가 사라집니다. 이 값만큼
 *                                 더 높이 올라가 상부댐이 작게 보이도록 합니다.
 * @param {number} [o.rangeScale]  최종 거리 배율. 상부댐을 더 멀리 띄워
 *                                 "고지대로 퍼올린다"는 느낌을 주는 용도.
 * @param {number} [o.padding]     여유 배율
 * @param {number} [o.minRange]    최소 거리 — 근접 시 지형 클리핑 방지
 * @param {number} [o.maxRange]
 * @returns {{lon,lat,height,headingDeg,pitchDeg,range,mode,alongM,acrossM,
 *            coverX,coverY,limitedBy,clamped}}
 *
 * 주의: fraction 은 "화면의 지배축 1/3" 입니다. 저수지는 가늘고 길어서
 * 두 축을 동시에 1/3 로 맞출 수 없습니다 (그러면 화면 밖으로 넘칩니다).
 */
export function computeFloodView(o) {
  const {
    rings, bbox, dam, fsl,
    damHeight = 0,
    aspect = 16 / 9,
    fov = Math.PI / 3,
    fovy: fovyIn = null,
    fraction = 1 / 3,
    pitchDeg = -38,
    mode = 'auto',
    aimBias = 0.2,
    rangeBoost = 0,
    rangeScale = 1.0,
    padding = 1.0,
    minRange = 300,
    maxRange = 60000,
  } = o

  const ext = floodExtent(rings, bbox, dam)
  const p = Math.abs(pitchDeg) * D2R
  const sinP = Math.sin(p)
  const cosP = Math.cos(p)

  const fovy = fovyIn != null ? fovyIn : toFovy(fov, aspect)
  const tanY = Math.tan(fovy / 2)
  const tanX = tanY * aspect

  // 화면축 반(半)치수
  //  · 시선에 직교하는 지상 치수는 그대로 화면에 투영
  //  · 시선 방향 지상 치수는 sin|pitch| 로 단축
  //  · 댐 높이(수직)는 cos|pitch| 로 투영
  const solve = (m) => {
    const broad = m === 'broadside'
    const headingDeg = broad ? (ext.axisDeg + 90) % 360 : ext.axisDeg
    const hX = (broad ? ext.alongM : ext.acrossM) / 2
    const hY = ((broad ? ext.acrossM : ext.alongM) * sinP + damHeight * cosP) / 2
    const Dx = hX / (fraction * tanX)
    const Dy = hY / (fraction * tanY)
    const raw = (Math.max(Dx, Dy) * padding + Math.max(0, rangeBoost)) * rangeScale
    return { m, headingDeg, hX, hY, raw, limitedBy: Dy >= Dx ? 'y' : 'x' }
  }

  let pick
  if (mode === 'auto') {
    const a = solve('axis'), b = solve('broadside')
    pick = b.raw < a.raw ? b : a
  } else {
    pick = solve(mode)
  }

  const range = Math.min(maxRange, Math.max(minRange, pick.raw))

  // 겨냥점은 정점 평균이 아니라 범위 중앙(midLon/midLat).
  // 거기서 aimBias 만큼 댐 쪽으로 당겨 댐이 프레임 안에 확실히 들어오게 합니다.
  const t = Math.min(1, Math.max(0, aimBias))
  const bx = ext.midLon, by = ext.midLat
  const lon = dam && Number.isFinite(dam.lon) ? bx + (dam.lon - bx) * t : bx
  const lat = dam && Number.isFinite(dam.lat) ? by + (dam.lat - by) * t : by

  return {
    lon, lat,
    height: fsl,
    headingDeg: pick.headingDeg,
    pitchDeg,
    range,
    mode: pick.m,
    alongM: ext.alongM,
    acrossM: ext.acrossM,
    // 실제 점유율 — 클램프가 걸리면 fraction 과 달라집니다. 검증용.
    coverX: pick.hX / range / tanX,
    coverY: pick.hY / range / tanY,
    limitedBy: pick.limitedBy,
    clamped: pick.raw !== range,
  }
}

/**
 * 카메라 위치를 목표점 기준 ENU 오프셋(동/북/상, m)으로 환산.
 * floodCamera.js 가 Cesium 변환행렬에 곱해 씁니다.
 */
export function enuOffset(headingDeg, pitchDeg, range) {
  const h = headingDeg * D2R
  const p = pitchDeg * D2R
  const cp = Math.cos(p)
  return {
    east: -Math.sin(h) * cp * range,
    north: -Math.cos(h) * cp * range,
    up: -Math.sin(p) * range,
  }
}

// ── 댐고 헬퍼 ────────────────────────────────────────
/** 댐별 사용 가능한 댐고 배열에서 가장 가까운 값 (CBC3_DOWN 은 40 부터 시작) */
export function snapHeight(heights, H) {
  if (!Array.isArray(heights) || heights.length === 0) return H
  let best = heights[0], bd = Infinity
  for (const h of heights) {
    const d = Math.abs(h - H)
    if (d < bd) { bd = d; best = h }
  }
  return best
}

export function clampHeight(heights, H) {
  if (!Array.isArray(heights) || heights.length === 0) return H
  return Math.min(heights[heights.length - 1], Math.max(heights[0], H))
}
