// ══════════════════════════════════════════════════════
//  useFlood.js — 댐 포커스 카메라 + 담수 애니메이션
//
//  ★ 저수량·수몰면적은 절대 브라우저에서 재계산하지 않습니다.
//    전부 floodPolygons.js (IfSAR DTM 5 m, Colab 2-6) 값을 그대로 씁니다.
//    세방히앙 원본은 sampleTerrainMostDetailed 로 Cesium World Terrain 에서
//    표고를 뽑아 저수량을 냈는데, 그걸 가져오면 "앱 = 엑셀"이 깨집니다.
//
//  ── 왜 수면 높이를 CallbackProperty 로 올리지 않는가 ──────────
//  Cesium GeometryUpdater 는 height 가 시간가변이면 DynamicGeometryUpdater 로
//  빠져 **매 프레임 폴리곤을 다시 테셀레이션**합니다. 우리 링은 최대 835점이라
//  60fps 로 돌리면 프레임을 갉아먹습니다.
//  반면 재질 색(알파)은 StaticGeometryColorBatch 가 색 attribute 만 갱신하므로
//  기하가 그대로 재사용됩니다.
//  → 높이는 10 m 이산 단계마다 고정하고, 인접 두 단계의 알파를 크로스페이드.
//    화면상으로는 물이 차오르는 것으로 읽히고, 보이는 모든 수면은
//    실제로 IfSAR 로 계산된 수위입니다.
//
//  smooth:true 를 주면 연속 상승(높이 콜백)으로 바뀝니다.
//  수몰면이 작은 상부댐에서만 권합니다.
// ══════════════════════════════════════════════════════
import { useRef, useState, useEffect, useCallback } from 'react'
import * as Cesium from 'cesium'
import { FLOOD_POLYGONS } from '../data/floodPolygons.js'
import { clampHeight, snapHeight } from './floodGeom.js'
import { planFloodView, flyToFloodView, setFloodView, damOf, floodSlice } from './floodCamera.js'

export const FILL_SPEEDS = [0.5, 1, 2, 4]

const WATER_RGB = Cesium.Color.fromCssColorString('#1f7fd0')
const WATER_ALPHA = 0.62
const EDGE_COLOR = Cesium.Color.fromCssColorString('#3fe3df').withAlpha(0.95)
const FSL_COLOR = Cesium.Color.fromCssColorString('#f0a500').withAlpha(0.9)

const EMPTY_UI = {
  damId: null, H: 0, fsl: 0, bed: 0,
  phase: 'idle',        // idle | filling | full | draining
  level: 0, pct: 0,
  stats: null,
  view: null,
  speed: 1,
}

export function useFlood({
  viewer,
  fraction = 1 / 3,
  pitchDeg = -38,
  mode = 'auto',
  fillSeconds = 8,
  flyDuration = 2.0,
  smooth = false,
} = {}) {
  const st = useRef({
    damId: null, H: 0, bed: 0, fsl: 0,
    levels: [],       // 이산 만수위 EL (하상 다음 단계부터 목표 댐고까지)
    slices: [],       // 대응 byHeight 슬라이스
    level: 0,
    stepIdx: -2,      // 현재 렌더 중인 아래 단계 (-1 = 첫 단계 이전)
    phase: 'idle',
    speed: 1,
    stats: null,
    view: null,
  })

  const lowRef = useRef([])     // 아래 단계 수면
  const highRef = useRef([])    // 위 단계 수면
  const edgeRef = useRef(null)  // 현재 수면 윤곽 (시안)
  const fslRef = useRef(null)   // 만수위 윤곽 (앰버, 정적)
  const rafRef = useRef(null)
  const lastT = useRef(null)

  const optRef = useRef({ fraction, pitchDeg, mode, fillSeconds, flyDuration, smooth })
  optRef.current = { fraction, pitchDeg, mode, fillSeconds, flyDuration, smooth }

  const [ui, setUi] = useState(EMPTY_UI)

  // ── 크로스페이드 알파 ────────────────────────────
  //  level ∈ [bed, levels[0]]      → low 만 서서히 등장
  //  level ∈ [levels[k], levels[k+1]] → low 가 빠지고 high 가 들어옴
  const alphas = () => {
    const s = st.current
    const k = s.stepIdx
    const lo = k < 0 ? s.bed : s.levels[k]
    const hi = k < 0 ? s.levels[0] : s.levels[k + 1]
    if (hi == null) return [WATER_ALPHA, 0]            // 마지막 단계
    const t = Math.min(1, Math.max(0, (s.level - lo) / Math.max(1e-6, hi - lo)))
    return k < 0 ? [WATER_ALPHA * t, 0] : [WATER_ALPHA * (1 - t), WATER_ALPHA * t]
  }

  const removeAll = useCallback((arr) => {
    const v = viewer
    if (v && !v.isDestroyed?.()) {
      for (const e of arr) { try { v.entities.remove(e) } catch { /* noop */ } }
    }
    arr.length = 0
  }, [viewer])

  const removeOne = useCallback((ref) => {
    const v = viewer
    if (ref.current && v && !v.isDestroyed?.()) {
      try { v.entities.remove(ref.current) } catch { /* noop */ }
    }
    ref.current = null
  }, [viewer])

  const clearEnts = useCallback(() => {
    removeAll(lowRef.current)
    removeAll(highRef.current)
    removeOne(edgeRef)
    removeOne(fslRef)
  }, [removeAll, removeOne])

  // ── 한 단계의 수면 폴리곤 (which: 0=아래, 1=위) ──
  const makeSurface = useCallback((slice, which, tag) => {
    const v = viewer
    const out = []
    if (!v || v.isDestroyed?.() || !slice) return out

    const colorCb = new Cesium.CallbackProperty(
      () => WATER_RGB.withAlpha(alphas()[which]), false
    )
    const heightProp = optRef.current.smooth
      ? new Cesium.CallbackProperty(() => st.current.level, false)   // 연속(무거움)
      : slice.fsl                                                    // 이산(가벼움)

    slice.rings.forEach((ring, i) => {
      const flat = []
      for (const p of ring) flat.push(p[0], p[1])
      if (flat.length < 6) return
      out.push(v.entities.add({
        id: `stage2-water-${tag}-${which}-${i}`,
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

  // ── 이산 단계 전환 (한 번 담수에 10여 회만 호출) ──
  const setStep = useCallback((k) => {
    const s = st.current
    s.stepIdx = k
    removeAll(lowRef.current)
    removeAll(highRef.current)
    removeOne(edgeRef)

    const tag = `${s.damId}-${k}-${Date.now().toString(36)}`
    if (k < 0) {
      lowRef.current = makeSurface(s.slices[0], 0, tag)
    } else {
      lowRef.current = makeSurface(s.slices[k], 0, tag)
      if (s.slices[k + 1]) highRef.current = makeSurface(s.slices[k + 1], 1, tag)
      edgeRef.current = makeLine(s.slices[k], EDGE_COLOR, `edge-${tag}`)
    }
  }, [removeAll, removeOne, makeSurface, makeLine])

  // ── UI 미러 (8 Hz) ────────────────────────────────
  const sync = useCallback(() => {
    const s = st.current
    const span = Math.max(1e-6, s.fsl - s.bed)
    setUi({
      damId: s.damId, H: s.H, fsl: s.fsl, bed: s.bed,
      phase: s.phase,
      level: s.level,
      pct: Math.min(1, Math.max(0, (s.level - s.bed) / span)),
      stats: s.stats || null,
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
    const loop = (t) => {
      const dt = lastT.current != null ? (t - lastT.current) / 1000 : 0
      lastT.current = t
      const s = st.current

      if ((s.phase === 'filling' || s.phase === 'draining') && dt > 0 && s.levels.length) {
        const span = Math.max(1e-6, s.fsl - s.bed)
        const rate = (span / Math.max(0.5, optRef.current.fillSeconds)) * s.speed
        s.level += (s.phase === 'filling' ? 1 : -1) * rate * dt

        if (s.level >= s.fsl) { s.level = s.fsl; s.phase = 'full'; sync() }
        if (s.level <= s.bed) { s.level = s.bed; s.phase = 'idle'; sync() }

        let k = -1
        for (let i = 0; i < s.levels.length; i++) if (s.levels[i] <= s.level) k = i
        if (k !== s.stepIdx) setStep(k)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(rafRef.current); lastT.current = null }
  }, [setStep, sync])

  useEffect(() => () => clearEnts(), [clearEnts])

  // ══ 액션 ═════════════════════════════════════════

  /**
   * 댐 선택 → 카메라 프레이밍 + 수면 준비.
   * @param {string} damId  'CBC1_DOWN' 등
   * @param {number} H      댐고(m). 그 댐에 없는 값이면 가장 가까운 값으로 스냅
   *                        (CBC3_DOWN 은 H=20·30 이 없어 40 으로 스냅됩니다)
   * @param {{autoFill?:boolean, fly?:boolean}} o
   */
  const focus = useCallback((damId, H, o = {}) => {
    const rec = FLOOD_POLYGONS[damId]
    if (!rec || !viewer || viewer.isDestroyed?.()) return null

    const Hs = snapHeight(rec.heights, clampHeight(rec.heights, H))
    const slice = floodSlice(damId, Hs)
    if (!slice) return null

    const levels = [], slices = []
    for (const h of rec.heights) {
      if (h > Hs) break
      const b = rec.byHeight[String(h)]
      if (b) { levels.push(b.fsl); slices.push(b) }
    }

    const view = planFloodView(viewer, damId, Hs, {
      fraction: optRef.current.fraction,
      pitchDeg: optRef.current.pitchDeg,
      mode: optRef.current.mode,
    })

    clearEnts()
    const s = st.current
    s.damId = damId
    s.H = Hs
    s.bed = rec.bed
    s.fsl = slice.fsl
    s.levels = levels
    s.slices = slices
    s.level = rec.bed
    s.stepIdx = -2
    s.phase = 'idle'
    s.view = view
    s.stats = {
      area_km2: slice.area_km2,
      volume_mm3: slice.volume_mm3,
      power_mw: slice.power_mw,
      energy_gwh: slice.energy_gwh,
      boundary: slice.boundary,
      damLabel: rec.label,
      damType: rec.damType,
      drop: rec.drop,
      offRiverM: damOf(damId)?.offRiverM ?? null,
    }

    setStep(-1)
    fslRef.current = makeLine(slice, FSL_COLOR, `fsl-${damId}-${Date.now().toString(36)}`)
    if (o.fly !== false) flyToFloodView(viewer, view, { duration: optRef.current.flyDuration })
    if (o.autoFill) s.phase = 'filling'
    sync()
    return view
  }, [viewer, clearEnts, setStep, makeLine, sync])

  const fill = useCallback(() => {
    const s = st.current
    if (!s.damId) return
    if (s.phase === 'full') { s.level = s.bed; setStep(-1) }
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
    s.phase = s.level >= s.fsl ? 'full' : 'idle'
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
    s.level = s.fsl
    s.phase = 'full'
    setStep(Math.max(0, s.levels.length - 1))
    sync()
  }, [setStep, sync])

  const setSpeed = useCallback((v) => { st.current.speed = v; sync() }, [sync])

  /** 카메라만 다시 맞춤 — 창 크기 변경 후 호출 (점유율은 종횡비에 직접 걸림) */
  const reframe = useCallback((animate = false) => {
    const s = st.current
    if (!s.damId || !viewer || viewer.isDestroyed?.()) return
    const view = planFloodView(viewer, s.damId, s.H, {
      fraction: optRef.current.fraction,
      pitchDeg: optRef.current.pitchDeg,
      mode: optRef.current.mode,
    })
    s.view = view
    if (animate) flyToFloodView(viewer, view, { duration: 1.0 })
    else setFloodView(viewer, view)
    sync()
  }, [viewer, sync])

  const clear = useCallback(() => {
    clearEnts()
    st.current = {
      damId: null, H: 0, bed: 0, fsl: 0, levels: [], slices: [],
      level: 0, stepIdx: -2, phase: 'idle', speed: st.current.speed,
      stats: null, view: null,
    }
    setUi(EMPTY_UI)
  }, [clearEnts])

  return { ui, focus, fill, drain, pause, toggle, setFull, setSpeed, reframe, clear }
}
