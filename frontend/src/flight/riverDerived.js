// ══════════════════════════════════════════════════════
//  riverDerived.js — 하천 종단 파생 데이터
//  세방히앙 index.html 의 computeDerived / detectHighlights / interp 포팅
//  (계산식 동일, 순수 함수로만 분리)
// ══════════════════════════════════════════════════════

export function medianFilter(a, w) {
  const h = w >> 1, o = new Array(a.length)
  for (let i = 0; i < a.length; i++) {
    const s = []
    for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) s.push(a[j])
    s.sort((x, y) => x - y)
    o[i] = s[s.length >> 1]
  }
  return o
}

export function movAvg(a, w) {
  const h = w >> 1, o = new Array(a.length)
  for (let i = 0; i < a.length; i++) {
    let s = 0, c = 0
    for (let j = Math.max(0, i - h); j <= Math.min(a.length - 1, i + h); j++) { s += a[j]; c++ }
    o[i] = s / c
  }
  return o
}

/** 배열 arr 을 분수 인덱스 fi 에서 선형보간 */
export function interpAt(arr, fi, N) {
  const i = Math.min(N - 2, Math.max(0, Math.floor(fi)))
  const t = fi - i
  return arr[i] + (arr[i + 1] - arr[i]) * t
}

/**
 * 종단 파생 데이터 일괄 계산.
 * eSm  : 표고 평활 (중앙값 9 → 이동평균 9) — 카메라 고도용
 * lonSm/latSm : 경로 평활 (이동평균 21) — 비행 경로가 덜 흔들리도록
 * slope: ±5점(=±500m) 구간 평균 경사 %
 */
export function computeDerived(river) {
  const N = river.d.length
  const STEP = river.step
  const LEN = river.d[N - 1]

  const eSm = movAvg(medianFilter(river.e, 9), 9)
  const lonSm = movAvg(river.lon, 21)
  const latSm = movAvg(river.lat, 21)

  const slope = new Array(N)
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 5), b = Math.min(N - 1, i + 5)
    slope[i] = (eSm[b] - eSm[a]) / ((b - a) * STEP) * 100
  }

  const EMIN = Math.min(...river.e) - 10
  const EMAX = Math.max(...river.e) + 10

  return { N, STEP, LEN, eSm, lonSm, latSm, slope, EMIN, EMAX }
}

/** 급경사 구간 탐지 — thr(%) 이상이 10점(=1km) 넘게 이어지고, 20점 이내 간격은 병합 */
export function detectHighlights(derived, thr) {
  const { N, slope } = derived
  const hits = slope.map(s => Math.abs(s) >= thr)
  const segs = []
  let s = -1
  for (let i = 0; i < N; i++) {
    if (hits[i] && s < 0) s = i
    if ((!hits[i] || i === N - 1) && s >= 0) { segs.push([s, hits[i] ? i : i - 1]); s = -1 }
  }
  const merged = []
  for (const g of segs) {
    if (merged.length && g[0] - merged[merged.length - 1][1] <= 20)
      merged[merged.length - 1][1] = g[1]
    else merged.push(g.slice())
  }
  return merged
    .filter(g => g[1] - g[0] >= 10)
    .map(g => {
      let m = 0
      for (let i = g[0]; i <= g[1]; i++) m = Math.max(m, Math.abs(derived.slope[i]))
      return { i0: g[0], i1: g[1], grade: m }
    })
}

export function inHighlight(highlights, idx) {
  return highlights.some(h => idx >= h.i0 && idx <= h.i1)
}
