// ══════════════════════════════════════════════════════
//  cesiumIon.js — Ion 토큰을 소스에서 뽑아 환경변수로
//
//  인수인계 §6 "부수 정리": 토큰이 CesiumViewer.jsx 6행에 하드코딩되어 있음.
//  깃 저장소에 토큰이 남으면 회수/교체 때마다 커밋이 필요하고,
//  퍼블릭 리포면 그대로 노출됩니다.
//
//  Render 대시보드 → Environment → VITE_CESIUM_TOKEN 등록.
//  ★ Vite 는 빌드 시점에 치환하므로, 값을 바꾸면 반드시 재배포해야 합니다.
//    (Render 에서 환경변수를 저장하면 자동으로 재빌드가 걸립니다)
// ══════════════════════════════════════════════════════
import * as Cesium from 'cesium'

/**
 * @param {string} [fallback] 이행 기간용 기존 하드코딩 토큰.
 *   환경변수 등록이 끝나면 이 인자를 빼고 호출하세요.
 */
export function initCesiumIon(fallback = '') {
  const token = (import.meta.env?.VITE_CESIUM_TOKEN || fallback || '').trim()
  if (token) {
    Cesium.Ion.defaultAccessToken = token
  } else {
    console.warn(
      '[cesium] VITE_CESIUM_TOKEN 이 없습니다. ' +
      'Ion 지형/영상 타일이 401 로 실패합니다. Render 환경변수를 확인하세요.'
    )
  }
  return !!token
}

export default initCesiumIon
