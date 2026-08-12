// ══════════════════════════════════════════════════════
//  useFlight.js — 하천 종단 비행 엔진
//  세방히앙 loop() / setCamera() / setPlaying() 포팅
//
//  설계 메모
//  · chain(현재 측점)은 React state 가 아니라 ref 에 둡니다.
//    60fps 로 setState 하면 트리 전체가 재렌더되므로, 차트·인덱스맵은
//    각자 rAF 로 ref 를 읽어 캔버스만 다시 그립니다.
//  · 버튼 하이라이트에 필요한 값(playing/dir/mode/…)만 state 로 미러링.
// ══════════════════════════════════════════════════════
import { useRef, useState, useEffect, useCallback } from 'react'
import * as Cesium from 'cesium'
import { interpAt, inHighlight } from './riverDerived.js'

export const SPEED_STEPS = [0.1, 0.3, 0.5, 1, 2, 5, 10]
export const EXAG_STEPS  = [1, 2, 3, 5]
export const MODES = [
  { id: 'std', label: '표준 3분' },
  { id: 'm1',  label: '1분' },
  { id: 'm1h', label: '1분H' },   // 급경사 구간에서 감속
]

export function useFlight({ viewer, river, derived, highlights, active }) {
  // 변경이 잦은 값 — ref
  const fl = useRef({
    chain: 0, playing: false, dir: -1,
    mode: 'std', speed: 1, agl: 700, exag: 2,
  })
  // UI 반영용 미러
  const [ui, setUi] = useState({
    playing: false, dir: -1, mode: 'std', speed: 1, agl: 700, exag: 2, chainKm: 0,
  })
  const rafRef = useRef(null)
  const lastT  = useRef(null)

  const sync = useCallback(() => {
    const f = fl.current
    setUi({
      playing: f.playing, dir: f.dir, mode: f.mode,
      speed: f.speed, agl: f.agl, exag: f.exag,
      chainKm: f.chain / 1000,
    })
  }, [])

  // ── 카메라 ────────────────────────────────────────
  const setCamera = useCallback(() => {
    if (!viewer || viewer.isDestroyed?.() || !derived) return
    const { N, STEP, LEN, eSm, lonSm, latSm } = derived
    const f = fl.current
    const fi = f.chain / STEP
    const lon  = interpAt(lonSm, fi, N)
    const lat  = interpAt(latSm, fi, N)
    const elev = interpAt(eSm, fi, N)

    // 진행 방향 3km 앞을 바라봄.
    // 구간 끝이라 전방점이 현재점과 겹치면 방위각이 정의되지 않으므로,
    // 반대쪽 점을 잡아 부호를 뒤집는다.
    const LOOK = 3000
    let fj = (f.chain + f.dir * LOOK) / STEP
    let flip = 1
    if (fj < 0 || fj > N - 1) {
      fj = (f.chain - f.dir * LOOK) / STEP
      flip = -1
    }
    fj = Math.max(0, Math.min(N - 1, fj))
    const lon2 = interpAt(lonSm, fj, N)
    const lat2 = interpAt(latSm, fj, N)
    const dLon = (lon2 - lon) * Math.cos(lat * Math.PI / 180) * flip
    const dLat = (lat2 - lat) * flip
    const heading = (dLon === 0 && dLat === 0)
      ? viewer.camera.heading
      : Math.atan2(dLon, dLat)

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, elev * f.exag + f.agl),
      orientation: { heading, pitch: Cesium.Math.toRadians(-22), roll: 0 },
    })
  }, [viewer, derived])

  // ── 재생 루프 ─────────────────────────────────────
  useEffect(() => {
    if (!active || !derived) return
    const { LEN, STEP } = derived

    const loop = (t) => {
      const dt = lastT.current !== null ? (t - lastT.current) / 1000 : 0
      lastT.current = t
      const f = fl.current

      if (f.playing && dt > 0) {
        // std: 전 구간 180초 기준 × 배속 / m1·m1h: 60초
        let v = f.mode === 'std' ? (LEN / 180) * f.speed : LEN / 60
        if (f.mode === 'm1h' && inHighlight(highlights, Math.round(f.chain / STEP))) v *= 0.5

        f.chain += f.dir * v * dt
        if (f.chain <= 0)   { f.chain = 0;   f.playing = false; sync() }
        if (f.chain >= LEN) { f.chain = LEN; f.playing = false; sync() }
        setCamera()
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafRef.current)
      lastT.current = null
    }
  }, [active, derived, highlights, setCamera, sync])

  // ── 컨트롤 ────────────────────────────────────────
  const ctrl = {
    play: () => {
      const f = fl.current, LEN = derived?.LEN ?? 0
      if (!f.playing) {
        // 끝에 닿아 있으면 반대쪽 끝으로 되감기
        if (f.dir < 0 && f.chain <= 0)   f.chain = LEN
        if (f.dir > 0 && f.chain >= LEN) f.chain = 0
      }
      f.playing = !f.playing
      setCamera(); sync()
    },
    toggleDir: () => { fl.current.dir *= -1; setCamera(); sync() },
    setMode:  (m) => { fl.current.mode = m; sync() },
    setSpeed: (s) => { fl.current.speed = s; sync() },
    setAgl:   (a) => { fl.current.agl = a; setCamera(); sync() },
    setExag:  (e) => { fl.current.exag = e; setCamera(); sync() },
    seek: (chain) => {
      const LEN = derived?.LEN ?? 0
      fl.current.chain = Math.max(0, Math.min(LEN, chain))
      setCamera(); sync()
    },
    stop: () => { fl.current.playing = false; sync() },
  }

  // 하천이 바뀌면 상류 끝에서 시작
  useEffect(() => {
    if (!derived) return
    fl.current.chain = derived.LEN
    sync()
  }, [derived, sync])

  return { fl, ui, ctrl, setCamera }
}
