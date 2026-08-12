// ══════════════════════════════════════════════════════
//  floodCamera.js — floodGeom 결과를 Cesium 카메라에 적용
//  (기하 계산은 전부 floodGeom.js. 여기는 Cesium 어댑터만)
// ══════════════════════════════════════════════════════
import * as Cesium from 'cesium'
import { computeFloodView, enuOffset, toFovy, clampHeight, snapHeight } from './floodGeom.js'
import { FLOOD_POLYGONS } from '../data/floodPolygons.js'
import { RIVER_DAMS } from '../data/riverData.js'

const D2R = Math.PI / 180

export function viewerAspect(viewer) {
  const c = viewer?.scene?.canvas ?? viewer?.canvas
  const w = c?.clientWidth || c?.width || 1600
  const h = c?.clientHeight || c?.height || 900
  return h > 0 ? w / h : 16 / 9
}

/** Cesium 은 aspect>1 일 때 fov 를 수평으로 씁니다. 항상 수직 FOV 로 환산. */
export function viewerFovy(viewer) {
  const f = viewer?.camera?.frustum
  const aspect = viewerAspect(viewer)
  if (f && Number.isFinite(f.fovy)) return f.fovy
  if (f && Number.isFinite(f.fov)) return toFovy(f.fov, aspect)
  return toFovy(Math.PI / 3, aspect)
}


/**
 * 하단 FlightBar 가 캔버스를 덮는 높이(px).
 *
 *  FlightBar 는 position:absolute 로 Cesium 캔버스 **위에** 얹혀 있습니다.
 *  즉 캔버스는 화면 전체 높이인데 아래쪽 240px 남짓은 보이지 않습니다.
 *  프레이밍을 캔버스 전체 기준으로 하면 대상이 캔버스 한가운데,
 *  즉 실제로는 바에 가려지는 쪽으로 치우쳐 잡힙니다.
 */
function bottomOverlayPx(viewer, opts) {
  if (Number.isFinite(opts?.bottomOverlayPx)) return opts.bottomOverlayPx
  if (typeof document === 'undefined') return 0
  const el = document.querySelector('.fb-root')
  return el?.offsetHeight ?? 0
}

/**
 * 가려지는 영역을 뺀 "보이는 뷰포트" 기준으로 FOV·종횡비를 환산.
 *  세로 FOV 는 보이는 높이만큼 좁히고, 가로는 그대로 유지되도록
 *  종횡비를 같은 비율로 늘립니다 (tanX = tanY_full × aspect_full 불변).
 */
function visibleFrustum(viewer, opts) {
  const c = viewer?.scene?.canvas ?? viewer?.canvas
  const H = c?.clientHeight || 900
  const ov = Math.min(Math.max(0, bottomOverlayPx(viewer, opts)), H * 0.6)
  const visH = Math.max(50, H - ov)
  const fovyFull = viewerFovy(viewer)
  const tanYFull = Math.tan(fovyFull / 2)
  const tanYVis = tanYFull * (visH / H)
  return {
    H, ov,
    fovy: 2 * Math.atan(tanYVis),
    aspect: viewerAspect(viewer) * (H / visH),
    tanYFull,
  }
}

/**
 * 겨냥점을 화면 위쪽으로 올려, 가려지는 하단을 피해 보이는 영역 한가운데
 * 오도록 합니다. 평면도(피치 -90 근처)에서 화면 위 = 시선 방향(heading).
 */
function liftAim(view, fr) {
  if (!view || !fr.ov) return view
  const p = Math.abs(view.pitchDeg) * Math.PI / 180
  const sinP = Math.max(0.05, Math.sin(p))
  const d = -(fr.ov / fr.H) * view.range * fr.tanYFull / sinP
  const h = view.headingDeg * Math.PI / 180
  const kx = 111320 * Math.cos(view.lat * Math.PI / 180)
  return {
    ...view,
    lon: view.lon + (d * Math.sin(h)) / kx,
    lat: view.lat + (d * Math.cos(h)) / 110540,
  }
}

/** 댐 ID → RIVER_DAMS 레코드 */
export function damOf(damId) {
  return RIVER_DAMS.find(d => d.id === damId) || null
}

/** 댐 ID + 댐고 → floodPolygons 슬라이스 (없으면 null) */
export function floodSlice(damId, H) {
  const rec = FLOOD_POLYGONS[damId]
  if (!rec) return null
  const h = snapHeight(rec.heights, clampHeight(rec.heights, H))
  const b = rec.byHeight[String(h)]
  return b ? { rec, H: h, ...b } : null
}

/**
 * 댐 + 댐고 → 카메라 파라미터.
 * 캔버스 종횡비와 실제 FOV 를 viewer 에서 읽으므로 창 크기가 바뀌면 값도 바뀝니다.
 */
export function planFloodView(viewer, damId, H, opts = {}) {
  const slice = floodSlice(damId, H)
  if (!slice) return null
  const dam = damOf(damId)

  // 상대고도 보정 — 상부댐은 낙차(drop)만큼 더 높이 올라갑니다.
  //  하부댐은 drop 이 null 이라 보정 0. 결과적으로 상부댐 저수지가
  //  하부댐보다 확실히 작게 보입니다.
  const isUpper = (slice.rec?.damType ?? dam?.type) === 'upper'
  const drop = slice.rec?.drop ?? dam?.drop ?? 0
  const elevBoost = opts.elevBoost ?? 1.0
  const rangeBoost = (drop || 0) * elevBoost
  // 상부댐만 한 번 더 멀리 — 주변 계곡이 함께 보여야 "퍼올린다"가 읽힙니다.
  const rangeScale = isUpper ? (opts.upperScale ?? 1.5) : 1.0

  const fr = visibleFrustum(viewer, opts)
  return liftAim(computeFloodView({
    rings: slice.rings,
    bbox: slice.bbox,
    dam: dam ? { lon: dam.lon, lat: dam.lat } : null,
    fsl: slice.fsl,
    damHeight: slice.H,
    aspect: fr.aspect,
    fovy: fr.fovy,
    fraction: opts.fraction ?? 1 / 3,
    pitchDeg: opts.pitchDeg ?? -38,
    mode: opts.mode ?? 'auto',
    aimBias: opts.aimBias ?? 0.2,
    rangeBoost,
    rangeScale,
    padding: opts.padding ?? 1.0,
    minRange: opts.minRange ?? 280,
    maxRange: opts.maxRange ?? 60000,
  }), fr)
}

/** view → 카메라 목적지 Cartesian3 (겨냥점 기준 ENU 오프셋을 지구좌표로) */
export function destinationOf(view) {
  const target = Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.height)
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(target)
  const o = enuOffset(view.headingDeg, view.pitchDeg, view.range)
  return Cesium.Matrix4.multiplyByPoint(
    enu, new Cesium.Cartesian3(o.east, o.north, o.up), new Cesium.Cartesian3()
  )
}

export function orientationOf(view) {
  return {
    heading: view.headingDeg * D2R,
    pitch: view.pitchDeg * D2R,
    roll: 0,
  }
}

/**
 * 애니메이션 이동.
 * duration 을 null/undefined 로 주면 Cesium 이 이동거리에 맞춰 시간을 정합니다.
 * 상부댐(수백 m)과 하부댐(수 km)의 이동거리가 크게 달라서, 고정 시간보다
 * 자동 계산 쪽이 훨씬 자연스럽습니다.
 */
export function flyToFloodView(viewer, view, { duration = null, onComplete } = {}) {
  if (!viewer || viewer.isDestroyed?.() || !view) return
  viewer.camera.cancelFlight?.()
  const opt = {
    destination: destinationOf(view),
    orientation: orientationOf(view),
    complete: onComplete,
  }
  if (duration != null) opt.duration = duration
  viewer.camera.flyTo(opt)
}

/** 즉시 이동 (창 리사이즈 재프레이밍용) */
export function setFloodView(viewer, view) {
  if (!viewer || viewer.isDestroyed?.() || !view) return
  viewer.camera.setView({
    destination: destinationOf(view),
    orientation: orientationOf(view),
  })
}

/**
 * 상부–하부 쌍(揚水 페어)을 한 화면에 담는 뷰.
 *
 *  상부댐만 프레이밍하면 하부댐이 1.0~2.4 km 떨어져 있어 화면 밖으로 나갑니다.
 *  두 수몰면의 링을 합쳐 하나의 범위로 놓고 거리를 역산합니다.
 *
 *  축은 "하부 → 합성중심" 방향, 즉 대략 하부→상부 방향(수압관로 축)입니다.
 *  broadside 로 두면 그 축이 화면 가로로 눕고, 왼쪽 하부 · 오른쪽 상부
 *  (또는 그 반대)로 나란히 보입니다.
 *
 *  이 모드에서는 elevBoost/upperScale 을 쓰지 않습니다. 이격거리가 이미
 *  범위를 지배해서(9~18 km) 추가 보정이 거의 의미가 없고, 하부댐이 함께
 *  보이는 것만으로 낙차가 읽히기 때문입니다.
 *
 * @param {string[]} ids  [상부ID, 하부ID] — 마지막 원소가 축 기준점
 */
export function planPairView(viewer, ids, H, opts = {}) {
  const list = ids.map(id => ({ id, s: floodSlice(id, H) })).filter(x => x.s)
  if (list.length === 0) return null
  if (list.length === 1) return planFloodView(viewer, list[0].id, H, opts)

  const rings = list.flatMap(x => x.s.rings)
  const bbox = list.reduce((acc, x) => ([
    Math.min(acc[0], x.s.bbox[0]), Math.min(acc[1], x.s.bbox[1]),
    Math.max(acc[2], x.s.bbox[2]), Math.max(acc[3], x.s.bbox[3]),
  ]), [Infinity, Infinity, -Infinity, -Infinity])

  const anchor = damOf(list[list.length - 1].id)
  const fsl = Math.max(...list.map(x => x.s.fsl))

  const fr = visibleFrustum(viewer, opts)
  return liftAim(computeFloodView({
    rings, bbox,
    dam: anchor ? { lon: anchor.lon, lat: anchor.lat } : null,
    fsl,
    damHeight: list[0].s.H,
    aspect: fr.aspect,
    fovy: fr.fovy,
    fraction: opts.fraction ?? 1 / 3,
    pitchDeg: opts.pitchDeg ?? -38,
    mode: 'broadside',
    aimBias: 0,
    rangeBoost: 0,
    rangeScale: 1,
    padding: opts.padding ?? 1.0,
    minRange: opts.minRange ?? 280,
    maxRange: opts.maxRange ?? 60000,
  }), fr)
}
