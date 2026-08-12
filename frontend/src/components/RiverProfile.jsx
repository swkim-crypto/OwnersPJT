// ══════════════════════════════════════════════════════
//  RiverProfile.jsx — 하천 종단 차트 (캔버스)
//  세방히앙 drawProfile() 포팅 + 댐 위치 표시
//
//  · X축 고정: 좌 = 하류(0k) → 우 = 상류
//  · 댐은 측점 세로선 + 라벨만. 하상고 마커는 그리지 않음
//    (종단선은 하천 중심선 DEM 값이라 하상고와 30~57m 차이가 있음 —
//     배경 표시용이므로 두 값을 같은 축에 올리지 않는다)
//  · 클릭/드래그로 해당 측점으로 이동
// ══════════════════════════════════════════════════════
import React, { useRef, useEffect, useCallback } from 'react'
import { interpAt } from '../flight/riverDerived.js'

const COL = {
  line:   '#3fe3df',
  fill:   'rgba(63,227,223,.08)',
  hl:     'rgba(242,169,59,.16)',
  hlBar:  'rgba(242,169,59,.55)',
  tick:   '#6f92a5',
  cursor: '#eef7fa',
  lower:  '#f0a500',
  upper:  '#00e5ff',
}

function tickStepKm(lenKm) {
  if (lenKm > 200) return 50
  if (lenKm > 80)  return 20
  if (lenKm > 30)  return 10
  if (lenKm > 12)  return 5
  return 2
}

export default function RiverProfile({ river, derived, highlights, dams, fl, selectedId, onSeek }) {
  const cvRef  = useRef(null)
  const rafRef = useRef(null)
  const dragRef = useRef(false)

  const draw = useCallback(() => {
    const cv = cvRef.current
    if (!cv || !river || !derived) return
    const ctx = cv.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const W = cv.width / dpr, H = cv.height / dpr
    const { N, STEP, LEN, EMIN, EMAX } = derived

    const xOf = d => (d / LEN) * W
    const yOf = e => H - 6 - (e - EMIN) / (EMAX - EMIN) * (H - 24)

    ctx.clearRect(0, 0, W, H)

    // 급경사 하이라이트
    for (const h of highlights) {
      const xa = xOf(river.d[h.i1]), xb = xOf(river.d[h.i0])
      const x1 = Math.min(xa, xb), wd = Math.abs(xb - xa)
      ctx.fillStyle = COL.hl;    ctx.fillRect(x1, 0, wd, H)
      ctx.fillStyle = COL.hlBar; ctx.fillRect(x1, H - 3, wd, 3)
    }

    // 종단선 + 채움
    ctx.beginPath()
    for (let i = N - 1; i >= 0; i--) {
      const x = xOf(river.d[i]), y = yOf(river.e[i])
      i === N - 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1.2; ctx.stroke()
    ctx.lineTo(xOf(0), H); ctx.lineTo(xOf(LEN), H); ctx.closePath()
    ctx.fillStyle = COL.fill; ctx.fill()

    // 눈금
    ctx.fillStyle = COL.tick
    ctx.font = '9px "IBM Plex Mono", monospace'
    const tk = tickStepKm(LEN / 1000)
    for (let k = 0; k <= LEN / 1000; k += tk) {
      const x = xOf(k * 1000)
      ctx.fillRect(x, H - 14, 1, 4)
      ctx.fillText(k + 'k', x + 2, H - 6)
    }
    ctx.fillText('하류(0k) →', 6, 10)
    ctx.textAlign = 'right'; ctx.fillText('→ 상류', W - 6, 10); ctx.textAlign = 'left'

    // 댐 위치
    for (const dm of dams) {
      const x = xOf(dm.d)
      const c = dm.type === 'upper' ? COL.upper : COL.lower
      const on = dm.id === selectedId
      ctx.save()
      ctx.strokeStyle = c
      ctx.globalAlpha = on ? 0.95 : 0.45
      ctx.lineWidth = on ? 2 : 1
      if (!on) ctx.setLineDash([2, 3])
      ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, H - 16); ctx.stroke()
      ctx.restore()
      if (on) {
        ctx.fillStyle = c
        ctx.font = '600 9px "IBM Plex Mono", monospace'
        const lbl = dm.label
        const tw = ctx.measureText(lbl).width
        ctx.fillText(lbl, Math.min(W - tw - 4, x + 4), 20)
      }
    }

    // 현재 위치 커서
    const chain = fl.current.chain
    const cx = xOf(chain)
    ctx.strokeStyle = COL.cursor; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke()
    const ce = interpAt(river.e, chain / STEP, N)
    ctx.fillStyle = COL.cursor
    ctx.beginPath(); ctx.arc(cx, yOf(ce), 3.5, 0, 7); ctx.fill()
  }, [river, derived, highlights, dams, fl, selectedId])

  // rAF 자체 루프 — chain 은 ref 라 React 재렌더 없이 따라간다
  useEffect(() => {
    const tick = () => { draw(); rafRef.current = requestAnimationFrame(tick) }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  // 리사이즈
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
    const ro = new ResizeObserver(fit)
    ro.observe(cv.parentElement)
    return () => ro.disconnect()
  }, [draw])

  const seekFrom = (ev) => {
    const cv = cvRef.current; if (!cv || !derived) return
    const r = cv.getBoundingClientRect()
    const x = ev.clientX - r.left
    onSeek((x / r.width) * derived.LEN)
  }

  return (
    <canvas
      ref={cvRef}
      className="rp-canvas"
      onPointerDown={e => { dragRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekFrom(e) }}
      onPointerMove={e => { if (dragRef.current) seekFrom(e) }}
      onPointerUp={e => { dragRef.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }}
    />
  )
}
