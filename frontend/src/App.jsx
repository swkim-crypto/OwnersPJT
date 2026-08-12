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

export default function App() {
  const [selected,   setSelected]   = useState(null)
  const [heightM,    setHeightM]    = useState(DEFAULT_H)
  const [showFlood,  setShowFlood]  = useState(false)
  const [flyTo,      setFlyTo]      = useState(null)

  const [simResult,  setSimResult]  = useState(null)
  const [simLoading, setSimLoading] = useState(false)

  const debounceRef = useRef(null)

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
  const handleSelect = useCallback((c, clearWater = true) => {
    setSelected(c)
    setHeightM(DEFAULT_H)          // 항상 100 m 댐 기준
    setShowFlood(false)
    setSimResult(null)
    runSimulate(c, DEFAULT_H)
    if (clearWater) flood.clear()
    setFlyTo({ id: c.id, ts: Date.now() })
  }, [runSimulate, flood])

  const handleHeightChange = useCallback((h) => {
    setHeightM(h)
    runSimulate(selected, h)
  }, [runSimulate, selected])

  // ── 댐 선택 → 비행 정지 + 수직 부감 + 담수 ─────
  //
  //  handleSelect 가 flyTo 를 갱신하면 CesiumViewer 의 flyToSelected(고정 1km)가
  //  카메라를 잡습니다. 그래서 flood.focus 는 다음 프레임으로 미뤄 마지막에
  //  들어가게 합니다. flyToFloodView 가 진행 중인 비행을 cancelFlight 로 끊습니다.
  const handleDamJump = useCallback((id) => {
    ctrl.stop()
    const c  = CANDIDATES.find(x => x.id === id)
    const dm = RIVER_DAMS.find(x => x.id === id)
    if (c) handleSelect(c, false)
    if (dm) ctrl.seek(dm.d)
    requestAnimationFrame(() => flood.focus(id, DEFAULT_H, { autoFill: true }))
  }, [ctrl, handleSelect, flood])

  // 댐고 슬라이더가 바뀌면 같은 댐을 다시 프레이밍 (담수는 시작하지 않음)
  useEffect(() => {
    const id = flood.ui.damId
    if (!id) return
    if (selected && selected.id !== id) return
    flood.focus(id, heightM, { autoFill: false })
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
      for (const dm of LOWER_DAMS) {
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
        armedRef.current.clear()
        prevChain.current = fl.current.chain
      }
      ctrl.play()
    },
  }), [ctrl, fl, flood])

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
          flyTo={flyTo}
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
