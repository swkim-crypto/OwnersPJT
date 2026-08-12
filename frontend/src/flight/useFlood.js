// ══════════════════════════════════════════════════════
//  useFlood.js — 댐 포커스 카메라 + 담수 애니메이션
//
//  ★ 저수량·수몰면적은 절대 브라우저에서 재계산하지 않습니다.
//    전부 floodPolygons.js (IfSAR DTM 5 m, Colab 2-6) 값을 그대로 씁니다.
//    세방히앙 원본은 sampleTerrainMostDetailed 로 Cesium World Terrain 에서
//    표고를 뽑아 저수량을 냈는데, 그걸 가져오면 "앱 = 엑셀"이 깨집니다.
//
//  ── 여러 저수지 동시 담수 ────────────────────────────
//  상부댐을 고르면 연결된 하부댐도 같이 채웁니다(양수 페어).
//  진행률 t(0~1)를 공통으로 쓰고 각 저수지가 자기 하상→만수위 구간을
//  t 비율만큼 채웁니다. 그래서 둘이 같이 시작해 같이 찹니다.
//
//  ── 왜 수면 높이를 CallbackProperty 로 올리지 않는가 ──
//  Cesium GeometryUpdater 는 height 가 시간가변이면 DynamicGeometryUpdater 로
//  빠져 매 프레임 폴리곤을 다시 테셀레이션합니다. 링이 최대 835점이라
//  60fps 로 돌리면 프레임을 갉아먹습니다. 반면 재질 색(알파)은
//  StaticGeometryColorBatch 가 색 attribute 만 갱신해 기하를 재사용합니다.
//  → 높이는 10 m 이산 단계마다 고정하고 인접 두 단계의 알파를 크로스페이드.
//    보이는 모든 수면은 실제로 IfSAR 로 계산된 수위입니다.
// ══════════════════════════════════════════════════════
import { useRef, useState, useEffect, useCallback } from 'react'
import * as Cesium from 'cesium'
import { FLOOD_POLYGONS } from '../data/floodPolygons.js'
import { clampHeight, snapHeight } from './floodGeom.js'
import {
  planFloodView, planPairView, flyToFloodView, setFloodView, damOf, floodSlice,
} from './floodCamera.js'

export const FILL_SPEEDS = [0.5, 1, 2, 4]

const WATER_RGB = Cesium.Color.fromCssColorString('#1f7fd0')
const WATER_ALPHA = 0.62
const EDGE_COLOR = Cesium.Color.fromCssColorString('#3fe3df').withAlpha(0.95)
const FSL_COLOR = Cesium.Color.fromCssColorString('#f0a500').withAlpha(0.9)

const EMPTY_UI = {
  damId: null, pairIds: [], H: 0, fsl: 0, bed: 0,
  phase: 'idle',        // idle | filling | full | draining
  level: 0, pct: 0,
  stats: null,
  pairStats: [],
  view: null,
  speed: 1,
}

export function useFlood({
  viewer,
  fraction = 1 / 3,
  pitchDeg = -38,
  mode = 'auto',
  elevBoost = 1.0,      // 상부댐 상대고도 보정 배율 (낙차 × 이 값만큼 더 높이)
  upperScale = 1.5,     // 상부댐 최종 거리 배율
  fillSeconds = 8,
  flyDuration = null,   // null = Cesium 자동(이동거리 비례)
  smooth = false,
} = {}) {
  //  res[i] = { id, bed, fsl, levels[], slices[], stepIdx }
  const st = useRef({
    damId: null, pairIds: [], H: 0,
    res: [],
    t: 0,               // 공통 진행률 0~1
    phase: 'idle',
    speed: 1,
    stats: null, pairStats: [], view: null,
  })

  //  ents[i] = { low:[], high:[], edge, fsl }
  const entsRef = useRef([])
  const rafRef = useRef(null)
  const lastT = useRef(null)

  const optRef = useRef({})
  optRef.current = {
    fraction, pitchDeg, mode, elevBoost, upperScale, fillSeconds, flyDuration, smooth,
  }

  const [ui, setUi] = useState(EMPTY_UI)

  const levelOf = (i) => {
    const r = st.current.res[i]
    if (!r) return 0
    return r.bed + st.current.t * (r.fsl - r.bed)
  }

  // ── 크로스페이드 알파 ────────────────────────────
  const alphas = (i) => {
    const r = st.current.res[i]
    if (!r) return [0, 0]
    const lv = levelOf(i)
    const k = r.stepIdx
    const lo = k < 0 ? r.bed : r.levels[k]
    const hi = k < 0 ? r.levels[0] : r.levels[k + 1]
    if (hi == null) return [WATER_ALPHA, 0]
    const u = Math.min(1, Math.max(0, (lv - lo) / Math.max(1e-6, hi - lo)))
    return k < 0 ? [WATER_ALPHA * u, 0] : [WATER_ALPHA * (1 - u), WATER_ALPHA * u]
  }

  // ── 엔티티 헬퍼 ──────────────────────────────────
  const rm = useCallback((e) => {
    const v = viewer
    if (e && v && !v.isDestroyed?.()) { try { v.entities.remove(e) } catch { /* noop */ } }
  }, [viewer])

  const clearEnts = useCallback(() => {
    for (const g of entsRef.current) {
      g.low.forEach(rm); g.high.forEach(rm); rm(g.edge); rm(g.fsl)
    }
    entsRef.current = []
  }, [rm])

  const makeSurface = useCallback((slice, i, which, tag) => {
    const v = viewer
    const out = []
    if (!v || v.isDestroyed?.() || !slice) return out
    const colorCb = new Cesium.CallbackProperty(
      () => WATER_RGB.withAlpha(alphas(i)[which]), false
    )
    const heightProp = optRef.current.smooth
      ? new Cesium.CallbackProperty(() => levelOf(i), false)   // 연속(무거움)
      : slice.fsl                                             // 이산(가벼움)

    slice.rings.forEach((ring, j) => {
      const flat = []
      for (const p of ring) flat.push(p[0], p[1])
      if (flat.length < 6) return
      out.push(v.entities.add({
        id: `stage2-water-${tag}-${which}-${j}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
          height: heightProp,
          material: new Cesium.ColorMaterialProperty(colorCb),
          outline: false,
          arcType: Cesium.ArcType.GEODESIC,
        },
      }))
    })
    return out
  }, [viewer])

  const makeLine = useCallback((slice, color, tag) => {
    const v = viewer
    if (!v || v.isDestroyed?.()) return null
    const ring = slice?.rings?.[0]
    if (!ring || ring.length < 3) return null
    const flat = []
    for (const p of ring) flat.push(p[0], p[1], slice.fsl)
    flat.push(ring[0][0], ring[0][1], slice.fsl)
    return v.entities.add({
      id: `stage2-line-${tag}`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat),
        width: 2, material: color, arcType: Cesium.ArcType.GEODESIC,
      },
    })
  }, [viewer])

  // ── 이산 단계 전환 (저수지별) ────────────────────
  const setStep = useCallback((i, k) => {
    const r = st.current.res[i]
    if (!r) return
    r.stepIdx = k
    const g = entsRef.current[i]
    if (!g) return
    g.low.forEach(rm); g.high.forEach(rm); rm(g.edge)
    g.low = []; g.high = []; g.edge = null

    const tag = `${r.id}-${k}-${Date.now().toString(36)}`
    if (k < 0) {
      g.low = makeSurface(r.slices[0], i, 0, tag)
    } else {
      g.low = makeSurface(r.slices[k], i, 0, tag)
      if (r.slices[k + 1]) g.high = makeSurface(r.slices[k + 1], i, 1, tag)
      g.edge = makeLine(r.slices[k], EDGE_COLOR, `edge-${tag}`)
    }
  }, [rm, makeSurface, makeLine])

  // ── UI 미러 (8 Hz) ────────────────────────────────
  const sync = useCallback(() => {
    const s = st.current
    const p = s.res[0]
    setUi({
      damId: s.damId, pairIds: s.pairIds, H: s.H,
      fsl: p?.fsl ?? 0, bed: p?.bed ?? 0,
      phase: s.phase,
      level: p ? p.bed + s.t * (p.fsl - p.bed) : 0,
      pct: s.t,
      stats: s.stats || null,
      pairStats: s.pairStats || [],
      view: s.view || null,
      speed: s.speed,
    })
  }, [])

  useEffect(() => {
    const t = setInterval(() => { if (st.current.damId) sync() }, 125)
    return () => clearInterval(t)
  }, [sync])

  // ── 담수 루프 ─────────────────────────────────────
  useEffect(() => {
    const loop = (now) => {
      const dt = lastT.current != null ? (now - lastT.current) / 1000 : 0
      lastT.current = now
      const s = st.current

      if ((s.phase === 'filling' || s.phase === 'draining') && dt > 0 && s.res.length) {
        const rate = (1 / Math.max(0.5, optRef.current.fillSeconds)) * s.speed
        s.t += (s.phase === 'filling' ? 1 : -1) * rate * dt

        if (s.t >= 1) { s.t = 1; s.phase = 'full'; sync() }
        if (s.t <= 0) { s.t = 0; s.phase = 'idle'; sync() }

        for (let i = 0; i < s.res.length; i++) {
          const r = s.res[i]
          const lv = r.bed + s.t * (r.fsl - r.bed)
          let k = -1
          for (let j = 0; j < r.levels.length; j++) if (r.levels[j] <= lv) k = j
          if (k !== r.stepIdx) setStep(i, k)
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(rafRef.current); lastT.current = null }
  }, [setStep, sync])

  useEffect(() => () => clearEnts(), [clearEnts])

  // ══ 액션 ═════════════════════════════════════════

  const buildRes = (id, H) => {
    const rec = FLOOD_POLYGONS[id]
    if (!rec) return null
    const Hs = snapHeight(rec.heights, clampHeight(rec.heights, H))
    const target = floodSlice(id, Hs)
    if (!target) return null
    const levels = [], slices = []
    for (const h of rec.heights) {
      if (h > Hs) break
      const b = rec.byHeight[String(h)]
      if (b) { levels.push(b.fsl); slices.push(b) }
    }
    return {
      id, rec, H: Hs, bed: rec.bed, fsl: target.fsl,
      levels, slices, stepIdx: -2, slice: target,
    }
  }

  /**
   * 댐 선택 → 카메라 프레이밍 + 수면 준비.
   * @param {string} damId
   * @param {number} H       댐고(m). 그 댐에 없으면 가장 가까운 값으로 스냅
   *                         (CBC3_DOWN 은 20·30 이 없어 40 으로 스냅)
   * @param {{autoFill?:boolean, fly?:boolean, pairWith?:string|string[]}} o
   *        pairWith: 함께 채울 댐. 상부댐 선택 시 연결 하부댐을 넘깁니다.
   */
  const focus = useCallback((damId, H, o = {}) => {
    if (!viewer || viewer.isDestroyed?.()) return null
    const pair = o.pairWith
      ? (Array.isArray(o.pairWith) ? o.pairWith : [o.pairWith])
      : []
    const ids = [damId, ...pair.filter(x => x && x !== damId)]

    const res = ids.map(id => buildRes(id, H)).filter(Boolean)
    if (!res.length) return null

    const view = res.length > 1
      ? planPairView(viewer, res.map(r => r.id), res[0].H, {
          fraction: optRef.current.fraction,
          pitchDeg: optRef.current.pitchDeg,
        })
      : planFloodView(viewer, damId, res[0].H, {
          fraction: optRef.current.fraction,
          pitchDeg: optRef.current.pitchDeg,
          mode: optRef.current.mode,
          elevBoost: optRef.current.elevBoost,
          upperScale: optRef.current.upperScale,
        })

    clearEnts()
    const s = st.current
    s.damId = damId
    s.pairIds = res.slice(1).map(r => r.id)
    s.H = res[0].H
    s.res = res
    s.t = 0
    s.phase = 'idle'
    s.view = view
    s.stats = {
      area_km2: res[0].slice.area_km2,
      volume_mm3: res[0].slice.volume_mm3,
      power_mw: res[0].slice.power_mw,
      energy_gwh: res[0].slice.energy_gwh,
      boundary: res[0].slice.boundary,
      damLabel: res[0].rec.label,
      damType: res[0].rec.damType,
      drop: res[0].rec.drop,
      offRiverM: damOf(damId)?.offRiverM ?? null,
    }
    s.pairStats = res.slice(1).map(r => ({
      id: r.id, label: r.rec.label,
      area_km2: r.slice.area_km2, volume_mm3: r.slice.volume_mm3,
    }))

    entsRef.current = res.map(() => ({ low: [], high: [], edge: null, fsl: null }))
    res.forEach((r, i) => {
      setStep(i, -1)
      entsRef.current[i].fsl = makeLine(
        r.slice, FSL_COLOR, `fsl-${r.id}-${Date.now().toString(36)}`
      )
    })

    if (o.fly !== false) flyToFloodView(viewer, view, { duration: optRef.current.flyDuration })
    if (o.autoFill) s.phase = 'filling'
    sync()
    return view
  }, [viewer, clearEnts, setStep, makeLine, sync])

  const fill = useCallback(() => {
    const s = st.current
    if (!s.damId) return
    if (s.phase === 'full') { s.t = 0; s.res.forEach((_, i) => setStep(i, -1)) }
    s.phase = 'filling'
    sync()
  }, [setStep, sync])

  const drain = useCallback(() => {
    if (!st.current.damId) return
    st.current.phase = 'draining'
    sync()
  }, [sync])

  const pause = useCallback(() => {
    const s = st.current
    s.phase = s.t >= 1 ? 'full' : 'idle'
    sync()
  }, [sync])

  const toggle = useCallback(() => {
    const p = st.current.phase
    if (p === 'filling' || p === 'draining') pause()
    else fill()
  }, [fill, pause])

  /** 즉시 만수위 */
  const setFull = useCallback(() => {
    const s = st.current
    if (!s.damId) return
    s.t = 1
    s.phase = 'full'
    s.res.forEach((r, i) => setStep(i, Math.max(0, r.levels.length - 1)))
    sync()
  }, [setStep, sync])

  const setSpeed = useCallback((v) => { st.current.speed = v; sync() }, [sync])

  /** 카메라만 다시 맞춤 — 창 크기 변경 후 호출 */
  const reframe = useCallback((animate = false) => {
    const s = st.current
    if (!s.damId || !viewer || viewer.isDestroyed?.()) return
    const view = s.res.length > 1
      ? planPairView(viewer, s.res.map(r => r.id), s.H, {
          fraction: optRef.current.fraction, pitchDeg: optRef.current.pitchDeg,
        })
      : planFloodView(viewer, s.damId, s.H, {
          fraction: optRef.current.fraction, pitchDeg: optRef.current.pitchDeg,
          mode: optRef.current.mode,
          elevBoost: optRef.current.elevBoost, upperScale: optRef.current.upperScale,
        })
    s.view = view
    if (animate) flyToFloodView(viewer, view, { duration: 1.0 })
    else setFloodView(viewer, view)
    sync()
  }, [viewer, sync])

  const clear = useCallback(() => {
    clearEnts()
    st.current = {
      damId: null, pairIds: [], H: 0, res: [], t: 0,
      phase: 'idle', speed: st.current.speed,
      stats: null, pairStats: [], view: null,
    }
    setUi(EMPTY_UI)
  }, [clearEnts])

  return { ui, focus, fill, drain, pause, toggle, setFull, setSpeed, reframe, clear }
}
