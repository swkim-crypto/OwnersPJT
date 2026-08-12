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

const SLOPE_THR = 3.0   // 급경사 하이라이트 임계값 (%)

export default function App() {
  // candidates는 로컬 고정 — 백엔드 /candidates fetch 제거
  // (구버전 캐시가 SA1/SA2 등을 덮어쓰는 문제 근본 해결)
  const [selected,   setSelected]   = useState(null)
  const [heightM,    setHeightM]    = useState(50)
  const [showFlood,  setShowFlood]  = useState(false)
  const [flyTo,      setFlyTo]      = useState(null)   // { id, ts } — 카메라 이동 트리거

  // 시뮬레이션 결과 상태
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

  // 하단 readout 용 현재 표고 (0.2초 간격이면 충분)
  const [curEl, setCurEl] = useState(0)
  useEffect(() => {
    const t = setInterval(() => {
      setCurEl(interpAt(RIVER.e, fl.current.chain / RIVER.step, derived.N))
    }, 200)
    return () => clearInterval(t)
  }, [derived, fl])

  // ── 담수 엔진 (2단계) ────────────────────────
  const flood = useFlood({
    viewer,
    fraction: 1 / 3,   // 수몰면이 차지할 화면 비율
    pitchDeg: -38,     // 내려다보는 각
    mode: 'auto',      // 'axis' | 'broadside' 로 고정 가능
    fillSeconds: 8,    // 하상 → 만수위 소요 (배속 ×1 기준)
  })

  // ── 시뮬레이션 API 호출 ──────────────────────
  const runSimulate = useCallback((dam, height) => {
    if (!dam) return
    setSimLoading(true)

    // 즉시 로컬 추정값으로 패널 업데이트 (응답 오기 전)
    const fsl        = calcFsl(dam, height)
    const vol_local  = estimateVolume(dam, height)
    const area_local = estimateArea(dam, height)
    setSimResult({
      fsl, area_km2: area_local, volume_mm3: vol_local,
      flood_geojson: null, source: 'local',
    })

    // 디바운스 300ms — 슬라이더 드래그 중 API 과호출 방지
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
        // 로컬 추정값 유지
      } finally {
        setSimLoading(false)
      }
    }, 300)
  }, [])

  // ── 댐 선택 ──────────────────────────────────
  //  clearWater=true : 사이드바/마커 클릭. 이전 담수 수면을 지웁니다.
  //  clearWater=false: 하단 댐 버튼. 곧바로 flood.focus 가 이어지므로 유지.
  const handleSelect = useCallback((c, clearWater = true) => {
    setSelected(c)
    const h = c.baseH ?? 50
    setHeightM(h)
    setShowFlood(false)
    setSimResult(null)
    runSimulate(c, h)
    if (clearWater) flood.clear()
    // ts를 매번 갱신 → 같은 댐 재클릭 시에도 카메라 이동 보장
    setFlyTo({ id: c.id, ts: Date.now() })
  }, [runSimulate, flood])

  // ── 높이 변경 ────────────────────────────────
  const handleHeightChange = useCallback((h) => {
    setHeightM(h)
    runSimulate(selected, h)
  }, [runSimulate, selected])

  // ── 하단 댐 버튼 → 비행 정지 + 수몰면 프레이밍 + 담수 ──
  //
  //  주의: handleSelect 가 flyTo 를 갱신하면 CesiumViewer 의
  //  flyToSelected(고정 1km)가 카메라를 잡습니다. 그래서 flood.focus 는
  //  다음 프레임으로 미뤄 마지막에 들어가게 합니다.
  //  flyToFloodView 는 진행 중인 비행을 cancelFlight 로 끊습니다.
  const handleDamJump = useCallback((id) => {
    ctrl.stop()
    const c  = CANDIDATES.find(x => x.id === id)
    const dm = RIVER_DAMS.find(x => x.id === id)
    if (c) handleSelect(c, false)
    if (dm) ctrl.seek(dm.d)               // 종단 커서도 그 측점으로
    const h = c?.baseH ?? heightM
    requestAnimationFrame(() => flood.focus(id, h, { autoFill: true }))
  }, [ctrl, handleSelect, flood, heightM])

  // 댐고가 바뀌면 같은 댐을 다시 프레이밍 (담수는 시작하지 않음)
  useEffect(() => {
    const id = flood.ui.damId
    if (!id) return
    if (selected && selected.id !== id) return
    flood.focus(id, heightM, { autoFill: false })
  }, [heightM])                            // eslint-disable-line

  // 창 크기가 바뀌면 재프레이밍 — 점유율은 종횡비에 직접 걸립니다
  useEffect(() => {
    let t = null
    const on = () => { clearTimeout(t); t = setTimeout(() => flood.reframe(false), 200) }
    window.addEventListener('resize', on)
    return () => { window.removeEventListener('resize', on); clearTimeout(t) }
  }, [flood])

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Sidebar
        candidates={CANDIDATES}
        selected={selected}
        onSelect={handleSelect}
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
          /* 2단계 담수 중에는 기존 수몰 폴리곤을 끕니다 (두 겹으로 깔리면 탁해짐) */
          showFlood={showFlood && !flood.ui.damId}
          simResult={simResult}
          flyTo={flyTo}
          onSelect={handleSelect}
          onViewerReady={setViewer}
          river={RIVER}
          showHint={false}
        />
        <FlightBar
          river={RIVER} derived={derived} highlights={highlights}
          dams={RIVER_DAMS} fl={fl} ui={flightUi} ctrl={ctrl}
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
