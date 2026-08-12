import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import Sidebar      from './components/Sidebar.jsx'
import DetailPanel  from './components/DetailPanel.jsx'
import CesiumViewer from './components/CesiumViewer.jsx'
import FlightBar    from './components/FlightBar.jsx'
import { CANDIDATES, estimateVolume, estimateArea, calcFsl } from './data/candidates.js'

// ── 1·2단계 ──────────────────────────────────────
import { RIVER, RIVER_DAMS, TRIBUTARIES } from './data/riverData.js'
import { computeDerived, detectHighlights, interpAt } from './flight/riverDerived.js'
import { useFlight } from './flight/useFlight.js'
import { useFlood }  from './flight/useFlood.js'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

const SLOPE_THR = 3.0    // 급경사 하이라이트 임계값 (%)
const DEFAULT_H = 100    // 댐 선택 시 기준 댐고 (m)

const LOWER_DAMS = RIVER_DAMS.filter(d => d.type === 'lower')
const UPPER_DAMS = RIVER_DAMS.filter(d => d.type === 'upper')

// 양수 페어 — 인수인계 §4 crossSections 페어링과 동일.
//  CBC1-하부가 상부 2개(CBC1·CBC2)를 받습니다.
const PAIR_LOWER = {
  CBC1_UP: 'CBC1_DOWN',
  CBC2_UP: 'CBC1_DOWN',
  CBC3_UP: 'CBC3_DOWN',
  CBC4_UP: 'CBC4_DOWN',
}

export default function App() {
  const [selected,   setSelected]   = useState(null)
  const [heightM,    setHeightM]    = useState(DEFAULT_H)
  const [showFlood,  setShowFlood]  = useState(false)

  const [simResult,  setSimResult]  = useState(null)
  const [simLoading, setSimLoading] = useState(false)

  const debounceRef = useRef(null)
  const lastFocusH  = useRef(DEFAULT_H)   // 마지막으로 flood.focus 에 넘긴 댐고

  // ── 비행 엔진 (1단계) ────────────────────────
  const [viewer, setViewer] = useState(null)

  const derived    = useMemo(() => computeDerived(RIVER), [])
  const highlights = useMemo(() => detectHighlights(derived, SLOPE_THR), [derived])

  const { fl, ui: flightUi, ctrl } = useFlight({
    viewer, river: RIVER, derived, highlights, active: !!viewer,
  })

  const [curEl, setCurEl] = useState(0)
  useEffect(() => {
    const t = setInterval(() => {
      setCurEl(interpAt(RIVER.e, fl.current.chain / RIVER.step, derived.N))
    }, 200)
    return () => clearInterval(t)
  }, [derived, fl])

  // ── 담수 엔진 (2단계) ────────────────────────
  //  수직 부감(평면도) 뷰. pitch -90 은 방위각이 불안정해져 -89.5 를 씁니다.
  //  평면도에서는 축선/측면 구분이 무의미하고 장축을 가로로 눕히는 쪽이
  //  항상 유리하므로 broadside 로 고정합니다.
  //  flyDuration:null → Cesium 이 이동거리에 맞춰 시간을 정합니다(자연스러운 등속).
  const flood = useFlood({
    viewer,
    fraction: 1 / 3,
    pitchDeg: -89.5,
    mode: 'broadside',
    elevBoost: 2.0,    // 상부댐은 낙차 × 2 만큼 더 높이 — 규모 차이가 보이도록
    upperScale: 1.5,   // 상부댐만 한 번 더 1.5배 — "고지대로 퍼올린다"는 느낌
    fillSeconds: 5,
    flyDuration: null,
  })

  // ── 시뮬레이션 API 호출 ──────────────────────
  const runSimulate = useCallback((dam, height) => {
    if (!dam) return
    setSimLoading(true)

    const fsl        = calcFsl(dam, height)
    const vol_local  = estimateVolume(dam, height)
    const area_local = estimateArea(dam, height)
    setSimResult({
      fsl, area_km2: area_local, volume_mm3: vol_local,
      flood_geojson: null, source: 'local',
    })

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(
          `${API_BASE}/simulate/${dam.id}?height=${height}`,
          { signal: AbortSignal.timeout(30000) }
        )
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        setSimResult({ ...data, source: 'api' })
      } catch (e) {
        console.warn('simulate API 실패, 로컬 추정값 사용:', e.message)
      } finally {
        setSimLoading(false)
      }
    }, 300)
  }, [])

  // ── 댐 선택 ──────────────────────────────────
  //  clearWater=true : 단순 선택. 이전 담수 수면을 지웁니다.
  //  clearWater=false: 곧바로 flood.focus 가 이어지는 경로(handleDamJump).
  //
  //  ★ flyTo 를 더 이상 쓰지 않습니다.
  //    flyTo 를 올리면 CesiumViewer 의 flyToSelected(전방 1km · 피치 -15°)가
  //    돌아서 2단계 수직 부감과 카메라를 다투게 됩니다. React 18 의 useEffect 는
  //    페인트 이후에 flush 되므로 requestAnimationFrame 보다 늦게 실행될 수
  //    있어, 어느 쪽이 마지막에 카메라를 잡을지 보장되지 않았습니다.
  //    (첫 댐에서 유독 잦았던 경사뷰의 원인)
  //    이제 댐 선택 경로는 handleDamJump 하나뿐이므로 flyTo 자체가 불필요합니다.
  const handleSelect = useCallback((c, clearWater = true) => {
    setSelected(c)
    setHeightM(DEFAULT_H)          // 항상 100 m 댐 기준
    setShowFlood(false)
    setSimResult(null)
    runSimulate(c, DEFAULT_H)
    if (clearWater) flood.clear()
  }, [runSimulate, flood])

  const handleHeightChange = useCallback((h) => {
    setHeightM(h)
    runSimulate(selected, h)
  }, [runSimulate, selected])

  // ── 댐 선택 → 비행 정지 + 수직 부감 + 담수 ─────
  //
  //  경쟁하는 카메라가 없어졌으므로 동기로 호출합니다.
  //  ctrl.seek 는 종단 커서를 옮기면서 setCamera 로 비행 카메라를 한 번 잡는데,
  //  바로 이어지는 flyToFloodView 가 그 지점에서 출발하므로 문제 없습니다.
  const handleDamJump = useCallback((id) => {
    ctrl.stop()
    const c  = CANDIDATES.find(x => x.id === id)
    const dm = RIVER_DAMS.find(x => x.id === id)
    if (c) handleSelect(c, false)
    if (dm) ctrl.seek(dm.d)
    lastFocusH.current = DEFAULT_H
    // 상부댐이면 연결된 하부댐도 함께 담수 (하부댐 단독 선택은 그 댐만)
    flood.focus(id, DEFAULT_H, { autoFill: true, pairWith: PAIR_LOWER[id] })
  }, [ctrl, handleSelect, flood])

  // 댐고 슬라이더가 바뀌면 같은 댐을 다시 프레이밍 (담수는 시작하지 않음)
  //
  //  lastFocusH 가드가 없으면: 슬라이더를 만진 뒤 다른 댐을 고를 때
  //  handleSelect 가 heightM 을 100 으로 되돌리면서 이 효과가 떠서
  //  방금 시작한 담수를 autoFill:false 로 덮어 꺼버립니다.
  useEffect(() => {
    const id = flood.ui.damId
    if (!id) return
    if (selected && selected.id !== id) return
    if (heightM === lastFocusH.current) return
    lastFocusH.current = heightM
    flood.focus(id, heightM, { autoFill: false, pairWith: PAIR_LOWER[id] })
  }, [heightM])                            // eslint-disable-line

  // 창 크기 변경 → 재프레이밍 (점유율은 종횡비에 직접 걸림)
  useEffect(() => {
    let t = null
    const on = () => { clearTimeout(t); t = setTimeout(() => flood.reframe(false), 200) }
    window.addEventListener('resize', on)
    return () => { window.removeEventListener('resize', on); clearTimeout(t) }
  }, [flood])

  // ── 재생 중 하부댐 통과 감지 ──────────────────
  //  측점 창(window)으로 잡으면 배속 ×10 에서 한 프레임에 900 m 를 건너뛰어
  //  놓칩니다. 이전 측점과 현재 측점 사이를 댐이 가로지르는지로 판정합니다.
  const prevChain = useRef(null)
  const armedRef  = useRef(new Set())

  useEffect(() => {
    const t = setInterval(() => {
      const f = fl.current
      if (!f.playing) { prevChain.current = f.chain; return }
      const c0 = prevChain.current
      const c1 = f.chain
      prevChain.current = c1
      if (c0 == null) return
      for (const dm of RIVER_DAMS) {          // 상·하부 모두
        if (armedRef.current.has(dm.id)) continue
        if ((c0 - dm.d) * (c1 - dm.d) <= 0) {   // 구간이 댐 측점을 가로질렀다
          armedRef.current.add(dm.id)
          handleDamJump(dm.id)
          break
        }
      }
    }, 80)
    return () => clearInterval(t)
  }, [fl, handleDamJump])

  /**
   * 재생 시작 시점의 측점에 걸쳐 있는 댐을 미리 armed 로 표시.
   *
   * handleDamJump 가 ctrl.seek(dm.d) 로 측점을 댐에 정확히 맞춰 놓기 때문에,
   * 재생을 누르면 c0 === dm.d 가 되어 (c0-d)*(c1-d) === 0 → 곧바로 재발동합니다.
   * 그래서 그 댐에서 제자리를 맴돌았습니다. 출발 지점의 댐은 건너뜁니다.
   */
  const armAtCurrent = useCallback(() => {
    const c = fl.current.chain
    armedRef.current.clear()
    for (const dm of RIVER_DAMS) {
      if (Math.abs(c - dm.d) <= 5) armedRef.current.add(dm.id)
    }
    prevChain.current = c
  }, [fl])

  // ── 재생 버튼 래핑 ────────────────────────────
  //  재생을 시작하면 댐 그래픽·수면을 걷어내고 비행 모드로 돌아갑니다.
  //  armed 를 비우고 prevChain 을 현재 위치로 리셋하므로,
  //  방금 멈춘 그 댐이 곧바로 다시 발동하지 않습니다.
  const ctrlUi = useMemo(() => ({
    ...ctrl,
    play: () => {
      if (!fl.current.playing) {
        flood.clear()
        setSelected(null)
        setSimResult(null)
        armAtCurrent()
      }
      ctrl.play()
    },
  }), [ctrl, fl, flood, armAtCurrent])

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {/* 좌측 = 상부댐만 */}
      <Sidebar
        candidates={UPPER_DAMS.map(d => CANDIDATES.find(c => c.id === d.id)).filter(Boolean)}
        selected={selected}
        onSelect={(c) => handleDamJump(c.id)}
        showFlood={showFlood}
        onToggleFlood={() => setShowFlood(v => !v)}
        river={RIVER}
        tributaries={TRIBUTARIES}
        dams={RIVER_DAMS}
        fl={fl}
        onSeek={ctrl.seek}
      />

      {/* FlightBar 가 position:absolute 이므로 부모에 position:relative 필수 */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', minWidth: 0 }}>
        <CesiumViewer
          candidates={CANDIDATES}
          selected={selected}
          heightM={heightM}
          showFlood={showFlood && !flood.ui.damId}
          simResult={simResult}
          onSelect={(c) => handleDamJump(c.id)}
          onViewerReady={setViewer}
          showHint={false}
        />
        {/* 하단 = 하부댐만 */}
        <FlightBar
          river={RIVER} derived={derived} highlights={highlights}
          dams={RIVER_DAMS} damButtons={LOWER_DAMS}
          fl={fl} ui={flightUi} ctrl={ctrlUi}
          selectedId={selected?.id} onDamJump={handleDamJump}
          currentEl={curEl}
          flood={flood}
          heightM={heightM}
          onHeightChange={handleHeightChange}
        />
      </div>

      <DetailPanel
        candidate={selected}
        heightM={heightM}
        onHeightChange={handleHeightChange}
        simResult={simResult}
        simLoading={simLoading}
      />
    </div>
  )
}
