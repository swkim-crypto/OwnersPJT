// ══════════════════════════════════════════════════════
//  IndexMap.jsx — 좌측 하단 인덱스맵
//  세방히앙 drawIndexMap() 포팅 + 지류·댐 마커 추가
//  클릭하면 그 지점에 가장 가까운 측점으로 이동
// ══════════════════════════════════════════════════════
import React, { useRef, useEffect, useCallback, useMemo } from 'react'

const COL = {
  river: '#3fe3df',
  trib:  'rgba(63,227,223,.35)',
  lower: '#f0a500',
  upper: '#00e5ff',
  pos:   '#eef7fa',
}

export default function IndexMap({ river, tributaries = [], dams = [], fl, selectedId, onSeek }) {
  const cvRef  = useRef(null)
  const rafRef = useRef(null)

  // 경계 상자 (하천 + 지류 전체)
  const bounds = useMemo(() => {
    if (!river) return null
    let lo0 = Infinity, la0 = Infinity, lo1 = -Infinity, la1 = -Infinity
    const push = (lons, lats) => {
      for (let i = 0; i < lons.length; i++) {
        lo0 = Math.min(lo0, lons[i]); lo1 = Math.max(lo1, lons[i])
        la0 = Math.min(la0, lats[i]); la1 = Math.max(la1, lats[i])
      }
    }
    push(river.lon, river.lat)
    tributaries.forEach(t => push(t.lon, t.lat))
    const padLo = (lo1 - lo0) * 0.06, padLa = (la1 - la0) * 0.06
    return { lo0: lo0 - padLo, lo1: lo1 + padLo, la0: la0 - padLa, la1: la1 + padLa }
  }, [river, tributaries])

  const draw = useCallback(() => {
    const cv = cvRef.current
    if (!cv || !river || !bounds) return
    const ctx = cv.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const W = cv.width / dpr, H = cv.height / dpr
    ctx.clearRect(0, 0, W, H)

    // 종횡비 유지 투영
    const dLo = bounds.lo1 - bounds.lo0
    const dLa = bounds.la1 - bounds.la0
    const kLo = Math.cos((bounds.la0 + bounds.la1) / 2 * Math.PI / 180)
    const sc  = Math.min(W / (dLo * kLo), H / dLa)
    const ox  = (W - dLo * kLo * sc) / 2
    const oy  = (H - dLa * sc) / 2
    const X = lo => ox + (lo - bounds.lo0) * kLo * sc
    const Y = la => H - oy - (la - bounds.la0) * sc

    // 지류
    ctx.strokeStyle = COL.trib; ctx.lineWidth = 1
    for (const t of tributaries) {
      ctx.beginPath()
      for (let i = 0; i < t.lon.length; i++) {
        const x = X(t.lon[i]), y = Y(t.lat[i])
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // 본류
    ctx.strokeStyle = COL.river; ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let i = 0; i < river.lon.length; i++) {
      const x = X(river.lon[i]), y = Y(river.lat[i])
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()

    // 댐 마커
    for (const dm of dams) {
      const x = X(dm.lon), y = Y(dm.lat)
      const c = dm.type === 'upper' ? COL.upper : COL.lower
      const on = dm.id === selectedId
      ctx.fillStyle = c
      ctx.globalAlpha = on ? 1 : 0.6
      ctx.beginPath(); ctx.arc(x, y, on ? 4 : 2.6, 0, 7); ctx.fill()
      if (on) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = c; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // 현재 비행 위치
    const N = river.d.length
    const idx = Math.max(0, Math.min(N - 1, Math.round(fl.current.chain / river.step)))
    const px = X(river.lon[idx]), py = Y(river.lat[idx])
    ctx.fillStyle = COL.pos
    ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fill()
    ctx.strokeStyle = COL.pos; ctx.lineWidth = 1; ctx.globalAlpha = 0.5
    ctx.beginPath(); ctx.arc(px, py, 6.5, 0, 7); ctx.stroke()
    ctx.globalAlpha = 1
  }, [river, tributaries, dams, bounds, fl, selectedId])

  useEffect(() => {
    const tick = () => { draw(); rafRef.current = requestAnimationFrame(tick) }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  useEffect(() => {
    const cv = cvRef.current; if (!cv) return
    const fit = () => {
      const r = cv.parentElement.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      cv.width = r.width * dpr; cv.height = r.height * dpr
      cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'
      cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(cv.parentElement)
    return () => ro.disconnect()
  }, [draw])

  // 클릭 → 가장 가까운 측점
  const handleClick = (ev) => {
    const cv = cvRef.current
    if (!cv || !river || !bounds || !onSeek) return
    const r = cv.getBoundingClientRect()
    const W = r.width, H = r.height
    const dLo = bounds.lo1 - bounds.lo0, dLa = bounds.la1 - bounds.la0
    const kLo = Math.cos((bounds.la0 + bounds.la1) / 2 * Math.PI / 180)
    const sc = Math.min(W / (dLo * kLo), H / dLa)
    const ox = (W - dLo * kLo * sc) / 2, oy = (H - dLa * sc) / 2
    const lo = bounds.lo0 + ((ev.clientX - r.left) - ox) / (kLo * sc)
    const la = bounds.la0 + (H - oy - (ev.clientY - r.top)) / sc

    let best = Infinity, bi = 0
    for (let i = 0; i < river.lon.length; i++) {
      const dx = (river.lon[i] - lo) * kLo, dy = river.lat[i] - la
      const d2 = dx * dx + dy * dy
      if (d2 < best) { best = d2; bi = i }
    }
    onSeek(river.d[bi])
  }

  return <canvas ref={cvRef} className="im-canvas" onClick={handleClick} />
}
