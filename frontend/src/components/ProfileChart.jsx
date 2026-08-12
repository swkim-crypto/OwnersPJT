import React, { useState, useMemo } from 'react'
import { calcFsl, estimateVolume, estimateArea } from '../data/candidates.js'

const W = 580, H = 260
const PAD = { top: 22, right: 24, bottom: 42, left: 58 }
const CW = W - PAD.left - PAD.right
const CH = H - PAD.top - PAD.bottom

// ── wallPts → 횡단면 [{d, elev}], bed=d:0 ────────────────
function wallPtsToProfile(wallPts) {
  if (!wallPts?.length) return []
  const elevs = wallPts.map(p => p[2])
  const bedIdx = elevs.indexOf(Math.min(...elevs))
  let cum = 0
  const raw = wallPts.map((p, i) => {
    if (i > 0) {
      const prev = wallPts[i - 1]
      const lat = (p[1] + prev[1]) / 2
      const dx = (p[0] - prev[0]) * 111000 * Math.cos((lat * Math.PI) / 180)
      const dy = (p[1] - prev[1]) * 111000
      cum += Math.sqrt(dx * dx + dy * dy)
    }
    return { d: cum, elev: p[2] }
  })
  const bedD = raw[bedIdx].d
  return raw.map(p => ({ d: Math.round((p.d - bedD) * 10) / 10, elev: p.elev }))
}

// ── wallPts 첫점/끝점 방위 ────────────────────────────────
function getBearing(wallPts) {
  if (!wallPts?.length) return { left: '?', right: '?' }
  const p1 = wallPts[0], p2 = wallPts[wallPts.length - 1]
  const dlon = p2[0] - p1[0], dlat = p2[1] - p1[1]
  const ns = dlat > 0 ? 'N' : 'S'
  const ew = dlon > 0 ? 'E' : 'W'
  return {
    left:  `${dlon > 0 ? 'W' : 'E'}${dlat > 0 ? 'S' : 'N'}`,
    right: `${ew}${ns}`,
  }
}

// ── 종단면 추정 ───────────────────────────────────────────
// 시작(d=0): bed 고도(실제), 끝(d=L): fsl 고도(실제)
// 중간: 오목 곡선(power 0.6) — 산악하천 형태 근사
// 무한대 방지: area(h)/area(h-5) > 2.5 이면 h-5 사용
function buildLongProfile(candidate, heightM) {
  const safeH = (() => {
    if (heightM <= 5) return heightM
    const a     = estimateArea(candidate, heightM)
    const aPrev = estimateArea(candidate, heightM - 5)
    if (!a || !aPrev || aPrev === 0) return heightM
    return a / aPrev > 2.5 ? heightM - 5 : heightM
  })()

  const fsl      = calcFsl(candidate, safeH)
  const area_km2 = estimateArea(candidate, safeH) ?? 0
  const vol_mm3  = estimateVolume(candidate, safeH) ?? 0

  // 종단 길이 추정: L = sqrt(A) × 형상계수(2.0)
  // 산악 V자 계곡 특성 반영, reservoirCoords 실측과 검증 완료
  const lengthM = Math.sqrt(area_km2 * 1e6) * 2.0

  const N = 60
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N
    return {
      d:    Math.round(t * lengthM),
      elev: Math.round((candidate.bed + (fsl - candidate.bed) * Math.pow(t, 0.6)) * 10) / 10,
    }
  })
  return { pts, lengthM, fsl, safeH }
}

// ── H-V-A 커브 ───────────────────────────────────────────
function buildHVA(candidate) {
  const steps = []
  for (let h = 5; h <= 85; h += 5) {
    const v = estimateVolume(candidate, h)
    const a = estimateArea(candidate, h)
    if (v != null && a != null) steps.push({ h, fsl: calcFsl(candidate, h), v, a })
  }
  return steps
}

// ── SVG 유틸 ─────────────────────────────────────────────
const makeSx = (dMin, dMax) => d => PAD.left + ((d - dMin) / (dMax - dMin)) * CW
const makeSy = (eMin, eMax) => e => PAD.top + CH - ((e - eMin) / (eMax - eMin)) * CH

function yTicksFor(eMin, eMax) {
  const raw = (eMax - eMin) / 6
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  const step = Math.ceil(raw / mag) * mag
  const ticks = []
  for (let v = Math.ceil(eMin / step) * step; v <= eMax; v += step) ticks.push(v)
  return ticks
}

function xTicksFor(dMin, dMax, mode) {
  const span = dMax - dMin
  const step = mode === 'long'
    ? (span > 10000 ? 2000 : span > 4000 ? 1000 : 500)
    : (span > 400 ? 100 : 50)
  const ticks = []
  for (let v = Math.ceil(dMin / step) * step; v <= dMax; v += step) ticks.push(v)
  return ticks
}

function waterSegments(data, fsl, sx, sy, wY) {
  let path = '', seg = []
  const flush = () => {
    if (seg.length >= 2) {
      const top = seg.map(([x]) => `${x.toFixed(1)},${wY.toFixed(1)}`).join(' L')
      const bot = [...seg].reverse().map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')
      path += `M${top} L${bot} Z `
    }
    seg = []
  }
  data.forEach(p => { p.elev < fsl ? seg.push([sx(p.d), sy(p.elev)]) : flush() })
  flush()
  return path
}

// ════════════════════════════════════════════════════════
export default function ProfileChart({ candidate, heightM }) {
  const [mode, setMode] = useState('cross')
  const fsl = calcFsl(candidate, heightM)

  const crossData  = useMemo(() => wallPtsToProfile(candidate?.wallPts), [candidate?.id])
  const bearing    = useMemo(() => getBearing(candidate?.wallPts),        [candidate?.id])
  const longResult = useMemo(() => candidate ? buildLongProfile(candidate, heightM) : null, [candidate?.id, heightM])
  const hvaData    = useMemo(() => candidate ? buildHVA(candidate) : [],  [candidate?.id])

  // ── 횡단면 ──────────────────────────────────
  const crossC = useMemo(() => {
    if (!crossData.length) return null
    const dMin = crossData[0].d, dMax = crossData[crossData.length - 1].d
    const elevs = crossData.map(p => p.elev)
    const eRange = Math.max(...elevs) - Math.min(...elevs)
    const eMin = Math.min(...elevs) - eRange * 0.04
    const eMax = Math.max(Math.max(...elevs), fsl) + eRange * 0.12
    const sx = makeSx(dMin, dMax), sy = makeSy(eMin, eMax)
    const wY = sy(fsl)

    const pathTerrain = [
      `M${sx(dMin).toFixed(1)},${sy(eMin).toFixed(1)}`,
      ...crossData.map(p => `L${sx(p.d).toFixed(1)},${sy(p.elev).toFixed(1)}`),
      `L${sx(dMax).toFixed(1)},${sy(eMin).toFixed(1)}`, 'Z',
    ].join(' ')

    const waterPath = waterSegments(crossData, fsl, sx, sy, wY)

    const left  = [...crossData].filter(p => p.d <= 0).reverse()
    const right = [...crossData].filter(p => p.d >= 0)
    let lEdge = null, rEdge = null
    for (let i = 0; i < left.length - 1; i++) {
      const a = left[i], b = left[i+1]
      if (a.elev <= fsl && b.elev > fsl) { lEdge = a.d + (fsl-a.elev)/(b.elev-a.elev)*(b.d-a.d); break }
    }
    for (let i = 0; i < right.length - 1; i++) {
      const a = right[i], b = right[i+1]
      if (a.elev <= fsl && b.elev > fsl) { rEdge = a.d + (fsl-a.elev)/(b.elev-a.elev)*(b.d-a.d); break }
    }
    let damTriPath = null, damLength = null
    if (lEdge !== null && rEdge !== null) {
      damLength = Math.round(Math.abs(rEdge - lEdge))
      const lx = sx(lEdge), rx = sx(rEdge), cx = sx(0), bedY = sy(candidate.bed)
      if ([lx,rx,cx,bedY].every(Number.isFinite))
        damTriPath = `M${lx.toFixed(1)},${wY.toFixed(1)} L${rx.toFixed(1)},${wY.toFixed(1)} L${cx.toFixed(1)},${bedY.toFixed(1)} Z`
    }
    return { sx, sy, wY, pathTerrain, waterPath, damTriPath, damLength,
             yTicks: yTicksFor(eMin, eMax), xTicks: xTicksFor(dMin, dMax, 'cross'),
             fslInRange: fsl >= eMin && fsl <= eMax }
  }, [crossData, fsl, candidate?.bed])

  // ── 종단면 ──────────────────────────────────
  const longC = useMemo(() => {
    if (!longResult) return null
    const { pts, lengthM, fsl: longFsl, safeH } = longResult
    if (!pts.length) return null
    const dMin = 0, dMax = lengthM
    const eMin = candidate.bed - (longFsl - candidate.bed) * 0.05
    const eMax = longFsl + (longFsl - candidate.bed) * 0.15
    const sx = makeSx(dMin, dMax), sy = makeSy(eMin, eMax)
    const wY = sy(longFsl)

    const pathTerrain = [
      `M${sx(0).toFixed(1)},${sy(eMin).toFixed(1)}`,
      ...pts.map(p => `L${sx(p.d).toFixed(1)},${sy(p.elev).toFixed(1)}`),
      `L${sx(dMax).toFixed(1)},${sy(eMin).toFixed(1)}`, 'Z',
    ].join(' ')

    const waterPath = waterSegments(pts, longFsl, sx, sy, wY)

    const damX = sx(0)
    const damPath = `M${(damX-5).toFixed(1)},${sy(longFsl).toFixed(1)} L${(damX+5).toFixed(1)},${sy(longFsl).toFixed(1)} L${(damX+14).toFixed(1)},${sy(candidate.bed).toFixed(1)} L${(damX-14).toFixed(1)},${sy(candidate.bed).toFixed(1)} Z`

    return { sx, sy, wY, pathTerrain, waterPath, damPath, longFsl, safeH,
             lengthKm: (lengthM/1000).toFixed(1),
             yTicks: yTicksFor(eMin, eMax), xTicks: xTicksFor(dMin, dMax, 'long') }
  }, [longResult, candidate?.bed])

  // ── H-V-A ────────────────────────────────────
  const hvaC = useMemo(() => {
    if (!hvaData.length) return null
    const vMax = Math.max(...hvaData.map(d => d.v))
    const aMax = Math.max(...hvaData.map(d => d.a))
    const hMax = Math.max(...hvaData.map(d => d.h))
    const sx  = h => PAD.left + (h / hMax) * CW
    const syV = v => PAD.top + CH - (v / (vMax * 1.1)) * CH
    const syA = a => PAD.top + CH - (a / (aMax * 1.1)) * CH
    const pathV = hvaData.map((d,i) => `${i===0?'M':'L'}${sx(d.h).toFixed(1)},${syV(d.v).toFixed(1)}`).join(' ')
    const pathA = hvaData.map((d,i) => `${i===0?'M':'L'}${sx(d.h).toFixed(1)},${syA(d.a).toFixed(1)}`).join(' ')
    const curD  = hvaData.reduce((a,b) => Math.abs(b.h-heightM)<Math.abs(a.h-heightM)?b:a)
    const vTicks = [0,.25,.5,.75,1].map(r => Math.round(vMax*r*10)/10)
    const xTicks = hvaData.filter(d => d.h % 20 === 0).map(d => d.h)
    return { sx, syV, syA, pathV, pathA, curX: sx(heightM), curD, vTicks, xTicks }
  }, [hvaData, heightM])

  const tabs = [
    { key:'cross', label:'횡단면 (댐 축)', ok: !!crossC },
    { key:'long',  label:'종단면 (추정)',  ok: !!longC  },
    { key:'hva',   label:'H-V-A 커브',    ok: !!hvaC   },
  ].filter(t => t.ok)

  if (!tabs.length) return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10,
      padding:'20px 12px', marginBottom:12, textAlign:'center' }}>
      <div style={{ fontSize:12, color:'#5a7a90', fontFamily:'var(--font-mono)' }}>단면 프로파일 — 데이터 없음</div>
    </div>
  )

  // 현재 mode가 없는 탭이면 첫 탭으로
  const activeMode = tabs.find(t => t.key === mode) ? mode : tabs[0].key

  return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10,
      padding:'10px 12px', marginBottom:12 }}>

      <div style={{ display:'flex', gap:6, marginBottom:8, alignItems:'center', flexWrap:'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setMode(t.key)} style={{
            padding:'4px 12px', fontSize:12, fontFamily:'var(--font-mono)',
            background: activeMode===t.key ? 'var(--acc-teal)' : 'transparent',
            color:      activeMode===t.key ? 'var(--bg-deep)' : '#a0bcd0',
            border:    `1px solid ${activeMode===t.key?'var(--acc-teal)':'rgba(255,255,255,0.15)'}`,
            borderRadius:4, fontWeight: activeMode===t.key?700:400,
          }}>{t.label}</button>
        ))}
        <span style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--acc-teal)', marginLeft:4 }}>
          FSL {fsl}m EL
        </span>
        {activeMode==='long' && longC?.safeH !== heightM && (
          <span style={{ fontSize:10, color:'var(--acc-amber)', fontFamily:'var(--font-mono)' }}>
            ⚠ H={longC?.safeH}m 기준 (면적 급증 방지)
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', display:'block' }}>
        <defs><clipPath id="chart-clip"><rect x={PAD.left} y={PAD.top} width={CW} height={CH}/></clipPath></defs>
        <rect x={PAD.left} y={PAD.top} width={CW} height={CH} fill="rgba(0,0,0,0.3)" rx="3"/>

        {activeMode==='cross' && crossC && (() => {
          const { sx, sy, wY, pathTerrain, waterPath, damTriPath, damLength, yTicks, xTicks, fslInRange } = crossC
          const fmtX = d => d===0?'0':`${d>0?'+':''}${d}m`
          return <>
            {yTicks.map(v=><g key={v}>
              <line x1={PAD.left} y1={sy(v)} x2={PAD.left+CW} y2={sy(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
              <text x={PAD.left-4} y={sy(v)+4} textAnchor="end" fontSize="10" fill="#7a9bb5" fontFamily="Space Mono">{v}</text>
            </g>)}
            {xTicks.map(d=><g key={d}>
              <line x1={sx(d)} y1={PAD.top} x2={sx(d)} y2={PAD.top+CH} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
              <text x={sx(d)} y={PAD.top+CH+14} textAnchor="middle" fontSize="10" fill="#7a9bb5" fontFamily="Space Mono">{fmtX(d)}</text>
            </g>)}
            <g clipPath="url(#chart-clip)">
              {waterPath&&<path d={waterPath} fill="rgba(30,120,255,0.48)"/>}
              {fslInRange&&<line x1={PAD.left} y1={wY} x2={PAD.left+CW} y2={wY} stroke="rgba(120,190,255,0.55)" strokeWidth="1"/>}
              {pathTerrain&&<path d={pathTerrain} fill="rgba(29,158,117,0.45)" stroke="#1d9e75" strokeWidth="1.5"/>}
              {fslInRange&&<line x1={PAD.left} y1={wY} x2={PAD.left+CW} y2={wY} stroke="#1a7fbd" strokeWidth="1.5" strokeDasharray="6,3"/>}
              {damTriPath&&<path d={damTriPath} fill="rgba(240,165,0,0.88)" stroke="#f0a500" strokeWidth="2"/>}
              <text x={PAD.left+8} y={PAD.top+15} fontSize="11" fill="#7a9bb5" fontFamily="Space Mono">← {bearing.left}</text>
              <text x={PAD.left+CW-8} y={PAD.top+15} textAnchor="end" fontSize="11" fill="#7a9bb5" fontFamily="Space Mono">{bearing.right} →</text>
            </g>
            {damLength&&Number.isFinite(damLength)&&<g>
              <rect x={PAD.left+CW-114} y={PAD.top+4} width={112} height={26} fill="rgba(0,196,180,0.18)" rx="4" stroke="var(--acc-teal)" strokeWidth="1"/>
              <text x={PAD.left+CW-58} y={PAD.top+13} textAnchor="middle" fontSize="9" fill="var(--acc-teal)" fontFamily="Space Mono">댐 길이</text>
              <text x={PAD.left+CW-58} y={PAD.top+25} textAnchor="middle" fontSize="12" fill="#fff" fontFamily="Space Mono" fontWeight="700">
                {damLength>=1000?`${(damLength/1000).toFixed(2)}km`:`${damLength}m`}
              </text>
            </g>}
            <text x={PAD.left-44} y={PAD.top+CH/2} textAnchor="middle" fontSize="10" fill="#7a9bb5"
              fontFamily="Space Mono" transform={`rotate(-90,${PAD.left-44},${PAD.top+CH/2})`}>고도 (m EL)</text>
          </>
        })()}

        {activeMode==='long' && longC && (() => {
          const { sx, sy, wY, pathTerrain, waterPath, damPath, longFsl, lengthKm, yTicks, xTicks } = longC
          const fmtX = d => d===0?'댐':`${(d/1000).toFixed(1)}km`
          return <>
            {yTicks.map(v=><g key={v}>
              <line x1={PAD.left} y1={sy(v)} x2={PAD.left+CW} y2={sy(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
              <text x={PAD.left-4} y={sy(v)+4} textAnchor="end" fontSize="10" fill="#7a9bb5" fontFamily="Space Mono">{v}</text>
            </g>)}
            {xTicks.map(d=><g key={d}>
              <line x1={sx(d)} y1={PAD.top} x2={sx(d)} y2={PAD.top+CH} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
              <text x={sx(d)} y={PAD.top+CH+14} textAnchor="middle" fontSize="10"
                fill={d===0?'#f0a500':'#7a9bb5'} fontFamily="Space Mono" fontWeight={d===0?700:400}>{fmtX(d)}</text>
            </g>)}
            <g clipPath="url(#chart-clip)">
              {waterPath&&<path d={waterPath} fill="rgba(30,120,255,0.48)"/>}
              <line x1={PAD.left} y1={wY} x2={PAD.left+CW} y2={wY} stroke="rgba(120,190,255,0.55)" strokeWidth="1"/>
              {pathTerrain&&<path d={pathTerrain} fill="rgba(29,158,117,0.45)" stroke="#1d9e75" strokeWidth="1.5"/>}
              <line x1={PAD.left} y1={wY} x2={PAD.left+CW} y2={wY} stroke="#1a7fbd" strokeWidth="1.5" strokeDasharray="6,3"/>
              {damPath&&<path d={damPath} fill="rgba(240,165,0,0.90)" stroke="#f0a500" strokeWidth="2"/>}
              <text x={PAD.left+8} y={PAD.top+15} fontSize="11" fill="#7a9bb5" fontFamily="Space Mono">댐 →</text>
              <text x={PAD.left+CW-8} y={PAD.top+15} textAnchor="end" fontSize="11" fill="#7a9bb5" fontFamily="Space Mono">← 상류</text>
            </g>
            <g>
              <rect x={PAD.left+CW-114} y={PAD.top+4} width={112} height={26} fill="rgba(26,111,255,0.18)" rx="4" stroke="#55aaff" strokeWidth="1"/>
              <text x={PAD.left+CW-58} y={PAD.top+13} textAnchor="middle" fontSize="9" fill="#55aaff" fontFamily="Space Mono">저수 연장 (추정)</text>
              <text x={PAD.left+CW-58} y={PAD.top+25} textAnchor="middle" fontSize="12" fill="#fff" fontFamily="Space Mono" fontWeight="700">{lengthKm} km</text>
            </g>
            <text x={PAD.left-44} y={PAD.top+CH/2} textAnchor="middle" fontSize="10" fill="#7a9bb5"
              fontFamily="Space Mono" transform={`rotate(-90,${PAD.left-44},${PAD.top+CH/2})`}>고도 (m EL)</text>
          </>
        })()}

        {activeMode==='hva' && hvaC && (() => {
          const { sx, syV, syA, pathV, pathA, curX, curD, vTicks, xTicks } = hvaC
          return <>
            {vTicks.map(v=><g key={v}>
              <line x1={PAD.left} y1={syV(v)} x2={PAD.left+CW} y2={syV(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
              <text x={PAD.left-4} y={syV(v)+4} textAnchor="end" fontSize="10" fill="#00c4b4" fontFamily="Space Mono">{v}</text>
            </g>)}
            {xTicks.map(h=><g key={h}>
              <line x1={sx(h)} y1={PAD.top} x2={sx(h)} y2={PAD.top+CH} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
              <text x={sx(h)} y={PAD.top+CH+14} textAnchor="middle" fontSize="10" fill="#7a9bb5" fontFamily="Space Mono">{h}m</text>
            </g>)}
            <g clipPath="url(#chart-clip)">
              <path d={pathV} fill="none" stroke="var(--acc-teal)" strokeWidth="2.5"/>
              <path d={pathA} fill="none" stroke="#f0a500" strokeWidth="1.5" strokeDasharray="5,3"/>
              <line x1={curX} y1={PAD.top} x2={curX} y2={PAD.top+CH} stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeDasharray="4,3"/>
              <circle cx={curX} cy={syV(curD.v)} r="5" fill="var(--acc-teal)" stroke="#fff" strokeWidth="1.5"/>
              <circle cx={curX} cy={syA(curD.a)} r="4" fill="#f0a500" stroke="#fff" strokeWidth="1.5"/>
              <rect x={curX+6} y={PAD.top+4} width={90} height={38} fill="rgba(0,0,0,0.6)" rx="4"/>
              <text x={curX+11} y={PAD.top+16} fontSize="10" fill="var(--acc-teal)" fontFamily="Space Mono">V {curD.v} Mm³</text>
              <text x={curX+11} y={PAD.top+29} fontSize="10" fill="#f0a500" fontFamily="Space Mono">A {curD.a} km²</text>
              <text x={curX+11} y={PAD.top+40} fontSize="9" fill="#aaa" fontFamily="Space Mono">H={heightM}m</text>
            </g>
            <text x={PAD.left-44} y={PAD.top+CH/2} textAnchor="middle" fontSize="10" fill="#00c4b4"
              fontFamily="Space Mono" transform={`rotate(-90,${PAD.left-44},${PAD.top+CH/2})`}>저수량 (Mm³)</text>
            <text x={PAD.left+CW+16} y={PAD.top+CH/2} textAnchor="middle" fontSize="10" fill="#f0a500"
              fontFamily="Space Mono" transform={`rotate(90,${PAD.left+CW+16},${PAD.top+CH/2})`}>면적 (km²)</text>
          </>
        })()}
      </svg>

      <div style={{ display:'flex', gap:14, marginTop:6, flexWrap:'wrap' }}>
        {(activeMode==='hva'?[
          {color:'var(--acc-teal)',label:'저수량 V (Mm³)',dash:false},
          {color:'#f0a500',label:'수몰면적 A (km²)',dash:true},
        ]:[
          {color:'#1d9e75',label:'지형',dash:false},
          {color:'rgba(30,120,255,0.7)',label:'저수',dash:false},
          {color:'#1a7fbd',label:`FSL ${fsl}m`,dash:true},
          {color:'#f0a500',label:activeMode==='cross'?'댐 (역삼각)':'댐 측면',dash:false},
        ]).map(item=>(
          <div key={item.label} style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'#a0bcd0',fontFamily:'var(--font-mono)'}}>
            <div style={{width:20,height:item.dash?0:3,background:item.color,
              borderTop:item.dash?`2px dashed ${item.color}`:'none',marginTop:item.dash?2:0}}/>
            {item.label}
          </div>
        ))}
        {activeMode==='long'&&(
          <span style={{fontSize:10,color:'#5a7a90',fontFamily:'var(--font-mono)',marginLeft:'auto'}}>
            ※ 시작·끝 고도 실제값, 중간 경사 추정
          </span>
        )}
      </div>
    </div>
  )
}
