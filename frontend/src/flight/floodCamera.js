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
  return computeFloodView({
    rings: slice.rings,
    bbox: slice.bbox,
    dam: dam ? { lon: dam.lon, lat: dam.lat } : null,
    fsl: slice.fsl,
    damHeight: slice.H,
    aspect: viewerAspect(viewer),
    fovy: viewerFovy(viewer),
    fraction: opts.fraction ?? 1 / 3,
    pitchDeg: opts.pitchDeg ?? -38,
    mode: opts.mode ?? 'auto',
    aimBias: opts.aimBias ?? 0.2,
    padding: opts.padding ?? 1.0,
    minRange: opts.minRange ?? 300,
    maxRange: opts.maxRange ?? 60000,
  })
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

/** 애니메이션 이동 */
export function flyToFloodView(viewer, view, { duration = 2.0, onComplete } = {}) {
  if (!viewer || viewer.isDestroyed?.() || !view) return
  viewer.camera.cancelFlight?.()
  viewer.camera.flyTo({
    destination: destinationOf(view),
    orientation: orientationOf(view),
    duration,
    complete: onComplete,
  })
}

/** 즉시 이동 (창 리사이즈 재프레이밍용) */
export function setFloodView(viewer, view) {
  if (!viewer || viewer.isDestroyed?.() || !view) return
  viewer.camera.setView({
    destination: destinationOf(view),
    orientation: orientationOf(view),
  })
}
