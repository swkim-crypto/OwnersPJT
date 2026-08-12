import React, { useEffect, useRef, useCallback, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { calcFsl } from '../data/candidates.js'
import { initCesiumIon } from '../config/cesiumIon.js'

// Ion 토큰. Render 환경변수 VITE_CESIUM_TOKEN 이 우선이고,
// 없으면 아래 기존 토큰으로 떨어집니다.
// 환경변수 등록이 확인되면 두 번째 인자를 지우세요.
initCesiumIon(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ5YS1lOTViYjlkZjdjNDkiLCJpZCI6MjU2NTQ1LCJpYXQiOjE3MzI2MDE0OTN9.l9OVl0-GEjkl7GxvGKD0bDjJSy3Ps1Ml9BhWQmVaABs'
)

// 상류 방위(compass °) — 카메라가 바라볼 방향. 댐축선 법선×upstream_sign 으로 산출.
const UP_BEARING = {
  CBC1_DOWN:147, CBC3_DOWN:143, CBC4_DOWN:116,
  CBC1_UP:123, CBC2_UP:60, CBC3_UP:53, CBC4_UP:38,
}

export function getDamLabel(id) {
  const MAP = {
    CBC1_DOWN:'CBC1-하부', CBC3_DOWN:'CBC3-하부', CBC4_DOWN:'CBC4-하부',
    CBC1_UP:'CBC1-상부', CBC2_UP:'CBC2-상부', CBC3_UP:'CBC3-상부', CBC4_UP:'CBC4-상부',
  }
  return MAP[id] ?? id
}

// 색상
const C_LOWER_WALL  = Cesium.Color.fromCssColorString('#f0a500').withAlpha(0.90)
const C_LOWER_OUTL  = Cesium.Color.fromCssColorString('#ffd700')
const C_LOWER_FLOOD = Cesium.Color.fromCssColorString('#1a6fff').withAlpha(0.45)
const C_LOWER_STR   = Cesium.Color.fromCssColorString('#55aaff').withAlpha(0.80)
const C_UPPER_WALL  = Cesium.Color.fromCssColorString('#00e5ff').withAlpha(0.88)
const C_UPPER_OUTL  = Cesium.Color.fromCssColorString('#80ffff')
const C_UPPER_FLOOD = Cesium.Color.fromCssColorString('#0d47a1').withAlpha(0.50)
const C_UPPER_STR   = Cesium.Color.fromCssColorString('#40c4ff').withAlpha(0.80)

export default function CesiumViewer({
  candidates, selected, heightM, showFlood, simResult, flyTo, onSelect,
  onViewerReady,          // ← 1단계: 비행 엔진이 카메라를 잡으려면 viewer 가 밖으로 나와야 함
  showHint = true,        // ← FlightBar 가 하단을 덮으므로 App 에서 false
}) {
  const containerRef = useRef(null)
  const viewerRef    = useRef(null)
  const damEntRef    = useRef([])
  const floodEntRef  = useRef([])
  const markerEntRef = useRef([])
  const readyCbRef   = useRef(onViewerReady)
  readyCbRef.current = onViewerReady

  const [ready, setReady] = useState(false)

  useEffect(() => {
    let viewer
    ;(async () => {
      try {
        viewer = new Cesium.Viewer(containerRef.current, {
          terrain: await Cesium.Terrain.fromWorldTerrain(),
          baseLayerPicker:false, navigationHelpButton:false, sceneModePicker:false,
          geocoder:false, homeButton:false, fullscreenButton:false,
          animation:false, timeline:false, infoBox:false, selectionIndicator:false,
          creditContainer: document.createElement('div'),
        })
        viewer.scene.skyAtmosphere.show = true
        viewer.scene.globe.enableLighting = false
        viewer.scene.globe.depthTestAgainstTerrain = false
        viewerRef.current = viewer

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(120.58, 16.66, 40000),
          orientation: { heading:0, pitch:Cesium.Math.toRadians(-30), roll:0 },
        })

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas)
        handler.setInputAction(click => {
          const picked = viewer.scene.pick(click.position)
          if (Cesium.defined(picked) && picked.id?.properties?.damId) {
            const id = picked.id.properties.damId.getValue()
            const c  = candidates.find(x => x.id === id)
            if (c) onSelect(c)
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

        readyCbRef.current?.(viewer)          // ← 1단계
        setReady(true)
      } catch (err) { console.error('Cesium 초기화 오류:', err) }
    })()
    return () => {
      readyCbRef.current?.(null)              // ← 1단계
      setReady(false)
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
      viewerRef.current = null
    }
  }, []) // eslint-disable-line

  const clearEnts = (ref) => {
    const v = viewerRef.current; if (!v) return
    ref.current.forEach(e => { try { v.entities.remove(e) } catch(_){} })
    ref.current = []
  }

  // ── 마커 ─────────────────────────────────────────
  const drawMarkers = useCallback(() => {
    const v = viewerRef.current; if (!v) return
    clearEnts(markerEntRef)
    candidates.forEach(c => {
      const isSel  = selected?.id === c.id
      const isUpper = c.damType === 'upper'
      const color  = isSel ? '#00c4b4' : isUpper ? '#00aaff' : '#f0a500'
      const size   = isSel ? 30 : 22
      // 지면 밀착형 마커.
      //  이전 버전은 52px 풍선 위에 원이 얹혀 있어 실제 지점보다 40px 가까이
      //  위에 찍혔습니다. 3D 지형에서 하천 어디에 있는지 읽기 어려웠습니다.
      //  → 원을 지면에 놓고, 라벨은 별도 label 로 옆에 붙입니다.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" fill="${color}" fill-opacity="0.95"
          stroke="#ffffff" stroke-width="1.6"/>
        <circle cx="12" cy="12" r="2.4" fill="#050c14" fill-opacity="0.85"/>
      </svg>`
      markerEntRef.current.push(v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(c.lon, c.lat),
        billboard: {
          image: `data:image/svg+xml;base64,${btoa(svg)}`,
          width:size, height:size,
          verticalOrigin:  Cesium.VerticalOrigin.CENTER,   // 지면에 딱 붙임
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: getDamLabel(c.id),
          font: `${isSel ? 13 : 11}px monospace`,
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(size * 0.75, 0),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { damId: c.id },
      }))
    })
  }, [candidates, selected])

  // ── 지형 밀착 벽체 ───────────────────────────────
  const _drawTerrainWall = (v, wallPts, fsl, isUpper, ref) => {
    const wc = isUpper ? C_UPPER_WALL : C_LOWER_WALL
    const oc = isUpper ? C_UPPER_OUTL : C_LOWER_OUTL
    ref.current.push(v.entities.add({
      wall: {
        positions:      Cesium.Cartesian3.fromDegreesArray(wallPts.flatMap(p=>[p[0],p[1]])),
        minimumHeights: wallPts.map(p=>p[2]),
        maximumHeights: wallPts.map(()=>fsl),
        material:wc, outline:true, outlineColor:oc, outlineWidth:2,
      },
    }))
    // 마루선
    ref.current.push(v.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArrayHeights(wallPts.flatMap(p=>[p[0],p[1],fsl])),
        width:4,
        material: new Cesium.PolylineOutlineMaterialProperty({ color:oc, outlineWidth:1, outlineColor:Cesium.Color.BLACK }),
      },
    }))
  }

  // ── 수몰 폴리곤 ──────────────────────────────────
  const _drawFloodPolygon = (v, rings, fsl, isUpper, ref) => {
    const fillColor = isUpper ? C_UPPER_FLOOD : C_LOWER_FLOOD
    const strColor  = isUpper ? C_UPPER_STR   : C_LOWER_STR
    rings.forEach(ring => {
      if (!ring?.length) return
      ref.current.push(v.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            ring.map(([lo,la]) => Cesium.Cartesian3.fromDegrees(lo, la, fsl))
          ),
          height: fsl,
          material: fillColor,
          outline: true, outlineColor: strColor, outlineWidth: 2,
          perPositionHeight: false,
        },
      }))
    })
  }

  // ── 댐 그리기 ────────────────────────────────────
  const drawDam = useCallback(() => {
    const v = viewerRef.current; if (!v) return
    clearEnts(damEntRef)
    if (!selected) return          // 재생 시작 시 selected=null → 댐 그래픽 제거

    const fsl     = calcFsl(selected, heightM)
    const isUpper = selected.damType === 'upper'
    const label   = getDamLabel(selected.id)

    // 지형 밀착 벽체
    if (selected.wallPts?.length >= 2) {
      _drawTerrainWall(v, selected.wallPts, fsl, isUpper, damEntRef)
    }

    // FSL 레이블
    const oc = isUpper ? C_UPPER_OUTL : C_LOWER_OUTL
    damEntRef.current.push(v.entities.add({
      position: Cesium.Cartesian3.fromDegrees(selected.lon, selected.lat, fsl + 25),
      label: {
        text: `${label} · FSL ${fsl.toFixed(0)} m`,
        font:'13px monospace', fillColor:oc,
        outlineColor:Cesium.Color.BLACK, outlineWidth:2,
        style:Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin:Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance:Number.POSITIVE_INFINITY,
      },
    }))
  }, [selected, heightM])

  // ── 수몰면 ───────────────────────────────────────
  const drawFlood = useCallback(() => {
    const v = viewerRef.current; if (!v) return
    clearEnts(floodEntRef)
    if (!showFlood || !selected) return

    const fsl     = calcFsl(selected, heightM)
    const isUpper = selected.damType === 'upper'

    // API 결과 우선
    const geojson = simResult?.flood_geojson
    if (geojson?.features?.length) {
      for (const feat of geojson.features) {
        const geom = feat.geometry; if (!geom) continue
        const rings = geom.type==='Polygon' ? geom.coordinates
          : geom.type==='MultiPolygon' ? geom.coordinates.flat() : []
        _drawFloodPolygon(v, rings, fsl, isUpper, floodEntRef)
      }
      return
    }

    // reservoirCoords fallback (상부댐 H=50 기준 형상, FSL만 현재값)
    if (selected.reservoirCoords?.length) {
      _drawFloodPolygon(v, selected.reservoirCoords, fsl, isUpper, floodEntRef)
    }
  }, [selected, showFlood, simResult, heightM])

  // ── 카메라 ───────────────────────────────────────
  // 댐 선택 시: 하류에서 상류 방면으로, 댐 전방 약 1km · 15° 상공에서 응시
  // (하단 댐 버튼으로 들어온 경우에는 2단계 flood.focus 가 이 뒤에 덮어씁니다)
  const flyToSelected = useCallback(() => {
    const v = viewerRef.current; if (!v || !selected) return
    const fsl  = calcFsl(selected, heightM)
    const up   = UP_BEARING[selected.id] ?? 0          // 상류 방위(°) = 시선 방향
    const down = (up + 180) % 360                      // 하류(카메라 위치) 방향
    const dist = 1000                                  // 댐 전방 1km
    const dRad = down * Math.PI / 180
    const dlat = (dist * Math.cos(dRad)) / 110540
    const dlon = (dist * Math.sin(dRad)) / (111320 * Math.cos(selected.lat * Math.PI / 180))
    const alt  = fsl + dist * Math.tan(15 * Math.PI / 180)   // 15° 부감각
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(selected.lon + dlon, selected.lat + dlat, alt),
      orientation: { heading: Cesium.Math.toRadians(up), pitch: Cesium.Math.toRadians(-15), roll: 0 },
      duration: 1.5,
    })
  }, [selected, heightM])

  useEffect(()=>{ drawMarkers() }, [drawMarkers])
  useEffect(()=>{ drawMarkers(); drawDam(); drawFlood() }, [ready, selected?.id])     // eslint-disable-line
  useEffect(()=>{ if(flyTo) flyToSelected() }, [flyTo])                              // eslint-disable-line
  useEffect(()=>{ drawDam(); drawFlood() }, [heightM])                               // eslint-disable-line
  useEffect(()=>{ drawFlood() }, [showFlood, simResult?.flood_geojson])              // eslint-disable-line

  return (
    <div ref={containerRef} style={{flex:1, position:'relative', background:'#000'}}>
      {showHint && (
        <div style={{
          position:'absolute', bottom:12, left:'50%', transform:'translateX(-50%)',
          background:'rgba(5,12,20,0.80)', border:'1px solid rgba(0,160,200,0.2)',
          borderRadius:4, padding:'5px 14px', fontSize:10,
          color:'rgba(160,200,220,0.7)', fontFamily:'monospace',
          pointerEvents:'none', zIndex:10, whiteSpace:'nowrap',
        }}>
          좌클릭 마커 선택 · 우클릭 드래그 회전 · 스크롤 줌
        </div>
      )}
    </div>
  )
}
