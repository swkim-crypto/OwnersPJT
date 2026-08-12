import React, { useMemo, useState, useEffect } from 'react'
import {
  estimateVolume, estimateArea, calcFsl, calcEfficiency, estimateEvap,
  PRIORITY_CONFIG, HEIGHT_STEPS, CANDIDATES,
} from '../data/candidates.js'
import { damLengths } from '../data/damLengths.js'
import ProfileChart from './ProfileChart.jsx'

const isApproxMode = c => c.bed == null || c.baseArea == null

function estimatePower(volumeMm3, dropM, opHours = 2000, eta = 0.85) {
  if (!volumeMm3 || !dropM || dropM <= 0) return { power: null, energy: null }
  const q = (volumeMm3 * 1e6) / (opHours * 3600)
  const power  = Math.round(9.8 * q * dropM * eta / 1000 * 10) / 10
  const energy = Math.round(power * opHours / 1000 * 10) / 10
  return { power, energy }
}

function getLinkedDams(candidate) {
  if (!candidate?.cat) return { lower: null, uppers: [] }
  const same = CANDIDATES.filter(c => c.cat === candidate.cat && c.id !== candidate.id)
  return {
    lower:  same.find(c => c.damType === 'lower') ?? null,
    uppers: same.filter(c => c.damType === 'upper'),
  }
}

function StatCard({ label, value, unit, sub, highlight, yellow }) {
  return (
    <div style={{ background:'var(--bg-card)', border:`1px solid ${highlight?'rgba(26,111,255,0.5)':yellow?'rgba(240,165,0,0.5)':'var(--border)'}`, borderRadius:6, padding:'6px 10px' }}>
      <div style={{ fontSize:11, color: yellow?'#f0a500':'#a0bcd0', fontFamily:'var(--font-mono)', marginBottom:2 }}>{label}</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:3 }}>
        <span style={{ fontSize: yellow?20:17, fontWeight:700, fontFamily:'var(--font-mono)', color: value==null?'#5a7a90': yellow?'#f0a500':'#e8eef4' }}>
          {value ?? '—'}
        </span>
        {value!=null && <span style={{ fontSize:12, color: yellow?'#ffd580':'#c0d4e0', fontWeight: yellow?600:400 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize:11, color: yellow?'rgba(240,165,0,0.7)':'#8aafc8', marginTop:1 }}>{sub}</div>}
    </div>
  )
}

export default function DetailPanel({ candidate, heightM, onHeightChange, simResult, simLoading }) {
  const approx = candidate ? isApproxMode(candidate) : false

  // 높이 컨트롤 상태: 스텝(10/5), 상한(120/200), 페이지
  const [stepMode, setStepMode] = useState(5)
  const [maxH, setMaxH] = useState(120)
  const [pageIdx, setPageIdx] = useState(0)
  const H_MIN = 20

  // 현재 스텝·상한 기준 전체 높이 → 필요 시 구간 페이지로 분할
  const allHeights = []
  for (let h = H_MIN; h <= maxH; h += stepMode) allHeights.push(h)
  const pages = []
  if (allHeights.length <= 22) {
    pages.push(allHeights)
  } else {
    let chunk = []
    for (const h of allHeights) {
      chunk.push(h)
      if (h === 120 && maxH > 120) { pages.push(chunk); chunk = [] }
    }
    if (chunk.length) pages.push(chunk)
  }
  const safePage = Math.min(pageIdx, pages.length - 1)
  const curHeights = pages[safePage]

  // 현재 높이가 속한 페이지로 자동 이동
  useEffect(() => {
    const idx = pages.findIndex(pg => pg.includes(heightM))
    if (idx >= 0 && idx !== pageIdx) setPageIdx(idx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightM, stepMode, maxH])

  const switchStep = (m) => {
    setStepMode(m)
    const snapped = Math.min(maxH, Math.max(H_MIN, Math.round(heightM / m) * m))
    if (snapped !== heightM) onHeightChange(snapped)
  }
  const switchMax = (mx) => {
    setMaxH(mx)
    if (heightM > mx) onHeightChange(mx)
  }

  const stats = useMemo(() => {
    if (!candidate) return null
    const isUpper = candidate.damType === 'upper'
    const drop = candidate.drop ?? 0
    if (simResult) {
      const pw = simResult.power_mw != null
        ? { power: simResult.power_mw, energy: simResult.energy_gwh }
        : estimatePower(simResult.volume_mm3, drop)
      return {
        fsl: simResult.fsl, a: simResult.area_km2, v: simResult.volume_mm3,
        er: calcEfficiency(simResult.volume_mm3, simResult.area_km2),
        evap: estimateEvap(simResult.area_km2), fromApi: simResult.source === 'api',
        power: isUpper ? pw.power : null, energy: isUpper ? pw.energy : null,
      }
    }
    const v = estimateVolume(candidate, heightM), a = estimateArea(candidate, heightM)
    const fsl = calcFsl(candidate, heightM)
    const pw = isUpper ? estimatePower(v, drop) : { power: null, energy: null }
    return { fsl, a, v, er: calcEfficiency(v,a), evap: estimateEvap(a), fromApi: false,
             power: pw.power, energy: pw.energy }
  }, [candidate, heightM, simResult])

  const linked = useMemo(() => candidate ? getLinkedDams(candidate) : null, [candidate])

  const damLength = useMemo(() => {
    if (!candidate || approx) return null
    const nearest = HEIGHT_STEPS.reduce((a,b) => Math.abs(b-heightM)<Math.abs(a-heightM)?b:a)
    return damLengths[candidate.id]?.[String(nearest)] ?? null
  }, [candidate, heightM, approx])

  if (!candidate || !stats) return (
    <div style={{ width:420, display:'flex', alignItems:'center', justifyContent:'center',
      color:'var(--text-sec)', fontSize:13, fontFamily:'var(--font-mono)', height:'100%',
      background:'var(--bg-panel)', borderLeft:'1px solid var(--border)' }}>
      후보지를 선택해 주세요
    </div>
  )

  const cfg    = PRIORITY_CONFIG[candidate.priority] ?? { color:'#888' }
  const isBase = heightM === candidate.baseH
  const baseV  = simResult?.source==='api' ? simResult.volume_mm3 : estimateVolume(candidate, candidate.baseH)
  const pct    = baseV ? Math.round(((stats.v - baseV) / baseV) * 100) : 0

  const toggleBtn = (active) => ({
    padding:'2px 9px', fontSize:11, fontFamily:'var(--font-mono)', borderRadius:5, cursor:'pointer',
    background: active ? 'var(--acc-teal)' : 'transparent',
    color:      active ? 'var(--bg-deep)' : '#a0bcd0',
    border:    `1px solid ${active ? 'var(--acc-teal)' : 'rgba(255,255,255,0.12)'}`,
    fontWeight: active ? 700 : 400,
  })

  return (
    <div style={{ width:420, background:'var(--bg-panel)', borderLeft:'1px solid var(--border)',
      display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0, height:'100%' }}>

      <div style={{ padding:'8px 14px 7px', borderBottom:'1px solid var(--border)', background:'var(--bg-card)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:3 }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:20, fontWeight:700, color:cfg.color }}>{candidate.id}</span>
          <div style={{ flex:1, padding:'2px 10px', background:`${cfg.color}22`, border:`1px solid ${cfg.color}55`,
            borderRadius:20, fontSize:12, color:cfg.color, fontFamily:'var(--font-mono)', textAlign:'center' }}>
            {candidate.priority}
          </div>
          {simLoading && (
            <span style={{ fontSize:10, color:'var(--acc-amber)', fontFamily:'var(--font-mono)', animation:'pulse 1s infinite' }}>⟳ 계산 중</span>
          )}
          {stats.fromApi && (
            <span style={{ fontSize:9, padding:'2px 6px', background:'rgba(26,111,255,0.15)',
              border:'1px solid rgba(26,111,255,0.4)', borderRadius:3, color:'#55aaff', fontFamily:'var(--font-mono)' }}>DEM 실측</span>
          )}
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <span style={{ fontSize:12, color:'#c0d4e0' }}>{candidate.region}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'#8aafc8' }}>
            {candidate.lat.toFixed(4)}N, {candidate.lon.toFixed(4)}E
          </span>
        </div>
      </div>

      <div style={{ overflow:'auto', flex:1, padding:'8px 12px 0' }}>

        {/* 높이 선택 */}
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border-acc)', borderRadius:8, padding:'8px 12px', marginBottom:8 }}>
          {/* 행1: 높이 + 댐길이 */}
          <div style={{ display:'flex', alignItems:'baseline', marginBottom:6 }}>
            <span style={{ fontSize:11, color:'var(--acc-teal)', fontFamily:'var(--font-mono)', marginRight:10 }}>높이</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:28, fontWeight:700, color:'var(--acc-teal)', lineHeight:1 }}>{heightM}</span>
            <span style={{ fontSize:13, color:'#c0d4e0', marginLeft:3 }}>m</span>
            <div style={{ flex:1 }} />
            {damLength != null && (
              <div style={{ display:'flex', alignItems:'baseline', gap:4, background:'rgba(240,165,0,0.12)',
                border:'1px solid rgba(240,165,0,0.35)', borderRadius:6, padding:'3px 10px' }}>
                <span style={{ fontSize:11, color:'#f0a500', fontFamily:'var(--font-mono)' }}>댐 길이</span>
                <span style={{ fontSize:16, fontWeight:700, color:'#f0a500', fontFamily:'var(--font-mono)', marginLeft:4 }}>
                  {damLength>=1000?`${(damLength/1000).toFixed(2)}km`:`${damLength}m`}
                </span>
              </div>
            )}
          </div>

          {/* 행2: 스텝 토글 + 범위 토글 + (페이지 칩) */}
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:4 }}>
              {[10,5].map(m => <button key={m} onClick={()=>switchStep(m)} style={toggleBtn(stepMode===m)}>{m}m</button>)}
            </div>
            <div style={{ width:1, height:16, background:'rgba(255,255,255,0.12)' }} />
            <div style={{ display:'flex', gap:4 }}>
              {[120,200].map(mx => <button key={mx} onClick={()=>switchMax(mx)} style={toggleBtn(maxH===mx)}>~{mx}</button>)}
            </div>
            {pages.length > 1 && <>
              <div style={{ flex:1 }} />
              <div style={{ display:'flex', gap:4 }}>
                {pages.map((pg,i) => (
                  <button key={i} onClick={()=>setPageIdx(i)} style={{
                    ...toggleBtn(i===safePage), padding:'2px 7px',
                  }}>{pg[0]}–{pg[pg.length-1]}</button>
                ))}
              </div>
            </>}
          </div>

          <input type="range" min={H_MIN} max={maxH} step={stepMode} value={heightM}
            onChange={e => onHeightChange(Number(e.target.value))}
            style={{ width:'100%', marginBottom:8, accentColor:'var(--acc-teal)', cursor:'pointer' }}
          />

          {/* 버튼 그리드 (현재 페이지) */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
            {curHeights.map(h => (
              <button key={h} onClick={() => onHeightChange(h)} style={{
                width:'calc(9.09% - 3px)', minWidth:30, padding:'3px 0',
                background: h===heightM ? 'var(--acc-teal)' : 'transparent',
                color:      h===heightM ? 'var(--bg-deep)' : '#a0bcd0',
                border:    `1px solid ${h===heightM?'var(--acc-teal)':'rgba(255,255,255,0.12)'}`,
                borderRadius:4, fontSize:11, fontFamily:'var(--font-mono)', fontWeight: h===heightM?700:400, cursor:'pointer',
              }}>{h}</button>
            ))}
          </div>
        </div>

        <div style={{ fontSize:11, color:'#a0bcd0', fontFamily:'var(--font-mono)', letterSpacing:'0.1em', marginBottom:4 }}>계산 결과</div>
        <div style={{ background:'var(--bg-card)', border:`1px solid ${stats.fromApi?'rgba(26,111,255,0.4)':'var(--border-acc)'}`,
          borderRadius:8, padding:'7px 12px', marginBottom:6, display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:'#a0bcd0', fontFamily:'var(--font-mono)' }}>총 저수량</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:24, fontWeight:700, color:'var(--acc-teal)' }}>
            {stats.v?.toLocaleString() ?? '—'}
          </span>
          <span style={{ fontSize:13, color:'#c0d4e0' }}>Mm³</span>
          {!isBase && pct !== 0 && (
            <span style={{ fontSize:12, padding:'1px 6px',
              background: pct>0?'rgba(29,158,117,0.15)':'rgba(224,92,92,0.15)',
              color:      pct>0?'var(--acc-green)':'var(--acc-red)',
              border:    `1px solid ${pct>0?'var(--acc-green)':'var(--acc-red)'}44`,
              borderRadius:4, fontFamily:'var(--font-mono)' }}>{pct>0?'+':''}{pct}%</span>
          )}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5, marginBottom:8 }}>
          <StatCard label="만수위 (FSL)"  value={stats.fsl}  unit="m EL"    highlight={stats.fromApi} />
          <StatCard label="수몰 면적"     value={stats.a}    unit="km²"     highlight={stats.fromApi} />
          <StatCard label="E-ratio"       value={stats.er}   unit="Mm³/km²" sub="저수량/수몰면적" />
          <StatCard label="증발 손실"     value={stats.evap} unit="Mm³/yr"  sub="1,500mm/yr" />
          {candidate.damType === 'upper' && <>
            <StatCard label="낙차 (Net Head)"  value={candidate.drop ?? '—'} unit="m" sub={`Bed ${candidate.bed}m EL`} yellow />
            <StatCard label="⚡ 추정 발전용량" value={stats.power} unit="MW"
              sub={stats.energy != null ? `${stats.energy} GWh/yr` : '2,000h/yr 기준'} yellow />
          </>}
        </div>

        {!approx
          ? <ProfileChart candidate={candidate} heightM={heightM} />
          : (
            <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10,
              padding:'20px 12px', marginBottom:12, textAlign:'center' }}>
              <div style={{ fontSize:12, color:'#5a7a90', fontFamily:'var(--font-mono)', marginBottom:6 }}>단면 프로파일</div>
              <div style={{ fontSize:11, color:'#8aafc8', lineHeight:1.8 }}>
                소유역 분석 완료 후 제공 예정<br/>
                <span style={{ color:'#BA7517' }}>집수면적 {candidate.upland_skm?.toLocaleString()} km² · 유량 {candidate.dis_av_cms} m³/s</span>
              </div>
            </div>
          )
        }

        <div style={{ fontSize:11, color:'#a0bcd0', fontFamily:'var(--font-mono)', letterSpacing:'0.1em', marginBottom:4 }}>기본 제원</div>
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', marginBottom:8 }}>
          {[
            ['하상 고도 (Bed)', candidate.bed!=null ? `${candidate.bed} m EL` : '—'],
            ['기준 높이',       `${candidate.baseH} m`],
            ['기준 FSL',        candidate.baseFsl!=null ? `${candidate.baseFsl} m EL` : '—'],
            ['기준 저수량',     `${candidate.baseV?.toLocaleString()} Mm³`],
            ['기준 수몰면적',   candidate.baseArea!=null ? `${candidate.baseArea} km²` : '—'],
          ].map(([label, value], i, arr) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between',
              padding:'5px 12px', borderBottom: i<arr.length-1?'1px solid var(--border)':'none', fontSize:12 }}>
              <span style={{ color:'#a0bcd0' }}>{label}</span>
              <span style={{ color: value==='—'?'#5a7a90':'#e8eef4', fontFamily:'var(--font-mono)', fontWeight:700 }}>{value}</span>
            </div>
          ))}
        </div>

        {linked && (linked.lower || linked.uppers.length > 0) && (
          <>
            <div style={{ fontSize:11, color:'#a0bcd0', fontFamily:'var(--font-mono)', letterSpacing:'0.1em', marginBottom:4 }}>
              연계 댐 ({candidate.cat} 시스템)
            </div>
            <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', marginBottom:8 }}>
              {linked.lower && (
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'5px 12px', borderBottom: linked.uppers.length > 0 ? '1px solid var(--border)' : 'none', fontSize:12 }}>
                  <span style={{ color:'#f0a500', fontFamily:'var(--font-mono)' }}>▼ 하부댐 (저수)</span>
                  <span style={{ color:'#e8eef4', fontFamily:'var(--font-mono)', fontWeight:700 }}>
                    {linked.lower.label}  Bed {linked.lower.bed}m · {linked.lower.baseV}Mm³
                  </span>
                </div>
              )}
              {linked.uppers.map((u, i) => (
                <div key={u.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                  padding:'5px 12px', borderBottom: i < linked.uppers.length - 1 ? '1px solid var(--border)' : 'none', fontSize:12 }}>
                  <span style={{ color:'#00aaff', fontFamily:'var(--font-mono)' }}>▲ 상부댐 (양수)</span>
                  <span style={{ color:'#e8eef4', fontFamily:'var(--font-mono)', fontWeight:700 }}>
                    {u.label}  낙차 {u.drop}m · {u.baseV}Mm³
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ background:'rgba(0,196,180,0.06)', border:'1px solid rgba(0,196,180,0.15)',
          borderRadius:8, padding:'7px 12px', marginBottom:14 }}>
          <div style={{ fontSize:11, color:'var(--acc-teal)', fontFamily:'var(--font-mono)', marginBottom:3 }}>NOTE</div>
          <div style={{ fontSize:12, color:'#c0d4e0', lineHeight:1.6 }}>{candidate.note}</div>
        </div>
      </div>
    </div>
  )
}
