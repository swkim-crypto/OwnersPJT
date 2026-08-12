import React from 'react'
import { PRIORITY_CONFIG, ANALYSIS_INFO } from '../data/candidates.js'
import { getDamLabel } from './CesiumViewer.jsx'
import IndexMap from './IndexMap.jsx'        // ← 1단계
import '../flight/flight.css'                // ← .im-wrap / .im-box 스타일

const REGION_ORDER = ['Abra Basin']

function getDamType(c) {
  if (c.damType) return c.damType
  if (c.id?.includes('upper')) return 'upper'
  return 'lower'
}

export default function Sidebar({
  candidates, selected, onSelect, mobile, showFlood, onToggleFlood,
  river, tributaries = [], dams = [], fl, onSeek,   // ← 1단계 인덱스맵
}) {
  const items      = (candidates ?? []).filter(c => REGION_ORDER.some(r => c.region === r))
  const upperItems = items.filter(c => getDamType(c) === 'upper')

  const renderItem = (c) => {
    const cfg   = PRIORITY_CONFIG[c.priority] ?? { color: '#888' }
    const isSel = selected?.id === c.id
    const label = getDamLabel(c.id)
    const isUp  = getDamType(c) === 'upper'
    return (
      <div key={c.id} onClick={() => onSelect(c)} style={{
        padding: mobile ? '13px 14px' : '10px 16px', cursor: 'pointer',
        background: isSel ? 'var(--bg-hover)' : 'transparent',
        borderLeft: isSel ? `3px solid ${cfg.color}` : '3px solid transparent',
        transition: 'background 0.15s', display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: mobile ? 17 : 15, fontWeight: 700,
            color: isSel ? cfg.color : isUp ? '#00aaff' : 'var(--text-pri)' }}>{label}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', background: `${cfg.color}22`, color: cfg.color,
            border: `1px solid ${cfg.color}66`, borderRadius: 10, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {c.priority}</span>
        </div>
        <div style={{ fontSize: mobile ? 12 : 11, color: 'var(--text-pri)', fontFamily: 'var(--font-mono)', opacity: 0.75 }}>
          {c.bed != null ? `Bed ${c.bed}m · ` : ''}V {c.baseV ?? 0} Mm³{isUp && c.drop ? ` · 낙차 ${c.drop}m` : ''}
        </div>
        {c.hMin5 != null && (
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)',
            color: c.hMin5 <= 60 ? '#1D9E75' : c.hMin5 <= 90 ? '#BA7517' : '#E05C5C' }}>
            5Mm³: H≥{c.hMin5}m {c.hMin5 <= 60 ? '✓' : c.hMin5 <= 90 ? '△' : '⚠'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ width: mobile ? '100%' : 252, background: 'var(--bg-panel)',
      borderRight: mobile ? 'none' : '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0, height: '100%' }}>

      {!mobile && (
        <div style={{ padding: '12px 18px 10px', borderBottom: '1px solid var(--border)',
          flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-sec)',
              letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>{ANALYSIS_INFO.basin.id}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-pri)', fontFamily: 'var(--font-mono)' }}>
              댐 후보지 분석 시스템</div>
          </div>
          <button onClick={onToggleFlood} style={{
            marginTop: 2, padding: '8px 16px', fontSize: 14, fontWeight: 800,
            fontFamily: 'var(--font-mono)', letterSpacing: '0.03em',
            background: showFlood ? '#1a6fff' : 'rgba(255,255,255,0.06)',
            color: showFlood ? '#ffffff' : 'var(--text-pri)',
            border: `2px solid ${showFlood ? '#55aaff' : 'rgba(255,255,255,0.22)'}`,
            borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
            boxShadow: showFlood ? '0 0 10px rgba(26,111,255,0.5)' : 'none',
            transition: 'all 0.15s' }}>💧 수몰</button>
        </div>
      )}

      <div style={{ padding: mobile ? '8px 12px' : '8px 14px 10px',
        borderBottom: '1px solid var(--border)', background: 'rgba(0,196,180,0.05)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>{ANALYSIS_INFO.analysisDate}</span>
          <span style={{ fontSize: 9, padding: '1px 6px', border: '1px solid var(--acc-teal)', borderRadius: 3,
            color: 'var(--acc-teal)', fontFamily: 'var(--font-mono)', background: 'rgba(0,196,180,0.15)' }}>{ANALYSIS_INFO.demSource}</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-sec)', fontFamily: 'var(--font-mono)', marginBottom: 3, lineHeight: 1.4 }}>{ANALYSIS_INFO.method}</div>
        <div style={{ fontSize: 10, color: 'var(--acc-teal)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>기준: {ANALYSIS_INFO.criterion}</div>
      </div>

      <div style={{ padding: mobile ? '8px 14px 4px' : '8px 18px 6px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-sec)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>상부댐 목록</div>
        <div style={{ fontSize: 11, color: 'var(--text-pri)', opacity: 0.6, marginTop: 2 }}>상부댐 {upperItems.length}개 · 탭하여 선택</div>
      </div>

      <div style={{ overflow: 'auto', flex: 1 }}>
        {/* 하부댐은 하단 FlightBar 버튼으로 접근합니다. 여기는 상부댐만. */}
        {upperItems.length > 0 && (<>
          <div style={{ padding: '8px 16px 3px', fontSize: 9, color: '#00aaff', fontFamily: 'var(--font-mono)',
            background: 'rgba(0,170,255,0.06)', borderTop: '1px solid var(--border)' }}>▼ 상부댐 (양수) {upperItems.length}개</div>
          {upperItems.map(renderItem)}
        </>)}
        {upperItems.length === 0 && items.length > 0 && (<>
          <div style={{ padding: '8px 16px 3px', fontSize: 9, color: 'var(--text-sec)',
            fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border)' }}>Abra 유역</div>
          {items.map(renderItem)}
        </>)}
        {items.length === 0 && (
          <div style={{ padding: '24px 18px', textAlign: 'center', fontSize: 12, color: 'var(--text-sec)', fontFamily: 'var(--font-mono)' }}>후보지 로딩 중...</div>
        )}
      </div>

      {/* 인덱스맵 (1단계) — 클릭하면 그 측점으로 이동 */}
      {river && fl && (
        <div className="im-wrap">
          <div className="im-title">INDEX MAP · 클릭해 측점 이동</div>
          <div className="im-box">
            <IndexMap
              river={river} tributaries={tributaries} dams={dams}
              fl={fl} selectedId={selected?.id} onSeek={onSeek}
            />
          </div>
        </div>
      )}

      {/* 삼안 로고 — 패널 최하단 (둥근 알약) */}
      <div style={{ padding: mobile ? '12px 16px' : '12px 18px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ display: 'inline-flex', width: '100%', boxSizing: 'border-box',
          background: '#ffffff', borderRadius: 13, padding: '7px 12px',
          alignItems: 'center', justifyContent: 'center' }}>
          <img src="/saman-logo.png" alt="삼안 saman"
            style={{ width: '100%', height: 'auto', display: 'block' }} />
        </span>
      </div>
    </div>
  )
}
