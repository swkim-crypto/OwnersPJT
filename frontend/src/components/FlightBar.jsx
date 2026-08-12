// ══════════════════════════════════════════════════════
//  FlightBar.jsx — 하단 비행 컨트롤 바 + 종단 차트
//  세방히앙 #bottom / #controls 포팅
//  댐 버튼: 하부 3개 · 상부 4개 — 누르면 onDamJump(id)
//
//  2단계 변경점 (1단계 파일과의 차이는 이것뿐):
//   · flood 프롭이 오면 맨 윗줄에 <FloodBar/> 담수 컨트롤을 얹습니다.
//   · 댐 버튼 title 에 해당 댐고의 저수량을 붙여 hover 로 확인 가능.
//   · 담수 중인 댐 버튼에 .filling 표시.
// ══════════════════════════════════════════════════════
import React from 'react'
import RiverProfile from './RiverProfile.jsx'
import FloodBar from './FloodBar.jsx'
import { SPEED_STEPS, EXAG_STEPS, MODES } from '../flight/useFlight.js'
import { FLOOD_POLYGONS } from '../data/floodPolygons.js'
import '../flight/flight.css'

export default function FlightBar({
  river, derived, highlights, dams, fl, ui, ctrl,
  selectedId, onDamJump, currentEl,
  flood, heightM, onHeightChange,      // ← 2단계 추가 (없어도 동작)
  damButtons,                          // ← 버튼으로 노출할 댐. 기본은 하부댐만
}) {
  if (!river || !derived) return null

  // 상부댐은 좌측 사이드바에서 고릅니다. 하단 버튼은 하부댐만.
  const btnDams = damButtons ?? dams.filter(d => d.type === 'lower')

  const damTitle = (dm) => {
    const rec = FLOOD_POLYGONS[dm.id]
    const b = rec?.byHeight?.[String(heightM ?? 50)]
    const base = `${dm.label} · 측점 ${(dm.d / 1000).toFixed(1)} km · 하상 EL ${dm.bed} m`
    if (!b) return base + (rec ? ` · H=${heightM}m 데이터 없음(최소 ${rec.heights[0]}m)` : '')
    return `${base}\n댐고 ${heightM} m → 만수위 EL ${b.fsl} m · 수몰 ${b.area_km2} km² · 저수 ${b.volume_mm3} Mm³`
  }

  const DamBtn = ({ dm }) => (
    <button
      className={'fb-dam ' + (dm.type === 'upper' ? 'up' : 'dn') +
                 (dm.id === selectedId ? ' on' : '') +
                 (flood?.ui?.damId === dm.id && flood.ui.phase === 'filling' ? ' filling' : '')}
      onClick={() => onDamJump?.(dm.id)}
      title={damTitle(dm)}
    >
      {dm.label.replace('-하부', '').replace('-상부', '')}
    </button>
  )

  return (
    <div className="fb-root">
      <FloodBar flood={flood} heightM={heightM} onHeightChange={onHeightChange} />

      <div className="fb-controls">
        <button className={'fb-btn primary' + (ui.playing ? ' on' : '')} onClick={ctrl.play}>
          {ui.playing ? '❚❚ 정지' : '▶ 재생'}
        </button>
        <button className="fb-btn" onClick={ctrl.toggleDir} title="비행 방향 전환">
          {ui.dir < 0 ? '▼ 하류행' : '▲ 상류행'}
        </button>

        <div className="fb-grp">
          <span className="fb-lbl">모드</span>
          {MODES.map(m => (
            <button key={m.id}
              className={'fb-btn sm' + (ui.mode === m.id ? ' on' : '')}
              onClick={() => ctrl.setMode(m.id)}>{m.label}</button>
          ))}
        </div>

        <div className="fb-grp">
          <span className="fb-lbl">배속</span>
          {SPEED_STEPS.map(s => (
            <button key={s}
              className={'fb-btn sm' + (ui.speed === s ? ' on' : '')}
              onClick={() => ctrl.setSpeed(s)}
              disabled={ui.mode !== 'std'}>×{s}</button>
          ))}
        </div>

        <div className="fb-grp">
          <span className="fb-lbl">과장</span>
          {EXAG_STEPS.map(e => (
            <button key={e}
              className={'fb-btn sm' + (ui.exag === e ? ' on' : '')}
              onClick={() => ctrl.setExag(e)}>×{e}</button>
          ))}
        </div>

        <div className="fb-grp">
          <span className="fb-lbl">고도</span>
          <input type="range" min={300} max={3000} step={100} value={ui.agl}
                 className="fb-range"
                 onChange={e => ctrl.setAgl(+e.target.value)} />
          <span className="fb-lbl mono cyan">{ui.agl} m</span>
        </div>

        <div className="fb-grp fb-dams">
          <span className="fb-lbl">하부댐</span>
          {btnDams.map(dm => <DamBtn key={dm.id} dm={dm} />)}
        </div>

        <div className="fb-readout mono">
          <b>{ui.chainKm.toFixed(1)}k</b> · EL <b>{Math.round(currentEl ?? 0)}m</b>
        </div>
      </div>

      <div className="fb-profile">
        <RiverProfile
          river={river} derived={derived} highlights={highlights}
          dams={dams} fl={fl} selectedId={selectedId}
          onSeek={ctrl.seek}
        />
      </div>
    </div>
  )
}
