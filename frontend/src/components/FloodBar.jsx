// ══════════════════════════════════════════════════════
//  FloodBar.jsx — 2단계 담수 컨트롤 행
//  FlightBar 안 첫 줄에 얹힙니다. flood 프롭이 없으면 렌더 안 함.
//
//  표시값은 전부 floodPolygons.js (IfSAR 5 m) 값 그대로.
//  브라우저에서 지형을 다시 샘플링해 계산하지 않습니다.
//
//  ★ 댐고 조절은 우측 DetailPanel 이 담당합니다. 여기 있던 슬라이더는
//    같은 값을 두 곳에서 만지는 중복이었고, 이 행을 한 줄에 담기 위해
//    제거했습니다. 대신 snapHeight 로 스냅된 '실제 적용 댐고'를 표시합니다.
//    (예: CBC3-하부는 H=20·30 데이터가 없어 30 을 골라도 40 으로 스냅됩니다)
// ══════════════════════════════════════════════════════
import React from 'react'
import { FILL_SPEEDS } from '../flight/useFlood.js'
import '../flight/flood.css'

const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d))

export default function FloodBar({ flood, heightM }) {
  if (!flood) return null
  const { ui, toggle, drain, setFull, setSpeed, reframe } = flood
  const active = !!ui.damId
  const running = ui.phase === 'filling' || ui.phase === 'draining'

  return (
    <div className="fd-row">
      <span className="fb-lbl">담수</span>

      <button className={'fb-btn primary' + (ui.phase === 'filling' ? ' on' : '')}
              onClick={toggle} disabled={!active}>
        {ui.phase === 'filling' ? '❚❚ 일시정지' : '▲ 담수'}
      </button>
      <button className="fb-btn" onClick={drain} disabled={!active}>▼ 방류</button>
      <button className="fb-btn" onClick={setFull} disabled={!active}>만수위</button>

      <div className="fb-grp">
        <span className="fb-lbl">속도</span>
        {FILL_SPEEDS.map(s => (
          <button key={s}
                  className={'fb-btn sm' + (ui.speed === s ? ' on' : '')}
                  onClick={() => setSpeed(s)} disabled={!active}>×{s}</button>
        ))}
      </div>

      {/* 읽기 전용 — 조절은 우측 패널. ui.H 는 스냅 후 실제 적용된 값 */}
      <div className="fb-grp">
        <span className="fb-lbl">댐고</span>
        <span className="fb-lbl mono cyan">{ui.H || heightM} m</span>
      </div>

      <button className="fb-btn sm" onClick={() => reframe(true)} disabled={!active}
              title="현재 창 크기에 맞춰 수몰면이 목표 점유율이 되도록 다시 잡습니다">⤢</button>

      {/* 수위 게이지 */}
      <div className="fd-gauge"
           title={`${ui.activeLabel ?? ''} EL ${fmt(ui.level, 1)} m / 만수위 ${fmt(ui.fsl, 1)} m`}>
        <div className="fd-gauge-fill" style={{ width: `${(ui.pct * 100).toFixed(1)}%` }} />
        <span className="fd-gauge-tx mono">
          {ui.activeLabel ? `${ui.activeLabel.replace('CBC', '')} ` : ''}
          EL {fmt(ui.level, 0)} / {fmt(ui.fsl, 0)} m
        </span>
      </div>

      {/* IfSAR 기반 제원 — 재계산 없음 */}
      <div className="fd-stats mono">
        {ui.stats ? (
          <>
            <b>{ui.stats.damLabel}</b>
            <span>수몰 {fmt(ui.stats.area_km2, 3)} km²</span>
            <span>저수 {fmt(ui.stats.volume_mm3, 2)} Mm³</span>
            {ui.stats.power_mw != null && <span>출력 {fmt(ui.stats.power_mw, 1)} MW</span>}
            {ui.stats.energy_gwh != null && <span>발전 {fmt(ui.stats.energy_gwh, 1)} GWh</span>}
            {ui.pairStats?.map(p => (
              <span key={p.id} className="fd-pair">
                + {p.label} 저수 {fmt(p.volume_mm3, 2)} Mm³
              </span>
            ))}
            {ui.view && (
              <span className="fd-dim">
                카메라 {Math.round(ui.view.range)} m · {ui.view.mode === 'broadside' ? '측면' : '축선'}
                {ui.view.clamped ? ' · 최소거리' : ''}
              </span>
            )}
          </>
        ) : <span className="fd-dim">댐 버튼을 누르면 그 위치로 이동합니다</span>}
      </div>

      {running && <span className="fd-live">● 담수중</span>}
    </div>
  )
}
