import './App.css'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

const AI_REVIEW_TITLE = '데모 발주 검토 의견'
const AI_REVIEW_MODEL_LABEL = '규칙 기반 예시'
const FIXED_DECISION_DATE = '2025-12-26'
const LOGIN_ACCESS_CODE = '711'
const KAKAO_MAP_APP_KEY = '' // Public demo uses the built-in diagram.

const CENTER_COORDS = {
  'DEMO-C01': { lat: 37.56, lng: 126.98, region: '수도권' },
  'DEMO-C02': { lat: 35.87, lng: 128.60, region: '영남' },
  'DEMO-C03': { lat: 36.35, lng: 127.38, region: '충청' },
  'DEMO-C04': { lat: 35.16, lng: 126.85, region: '호남' },
  'DEMO-C05': { lat: 33.50, lng: 126.53, region: '제주' },
}

const CENTER_NAME_COORDS = {
  수도권: CENTER_COORDS['DEMO-C01'], 영남: CENTER_COORDS['DEMO-C02'],
  충청: CENTER_COORDS['DEMO-C03'], 호남: CENTER_COORDS['DEMO-C04'],
  제주: CENTER_COORDS['DEMO-C05'],
}

const CENTER_MAP_POINTS = {
  'DEMO-C01': { x: 286, y: 172 }, 'DEMO-C02': { x: 492, y: 298 },
  'DEMO-C03': { x: 396, y: 276 }, 'DEMO-C04': { x: 320, y: 384 },
  'DEMO-C05': { x: 184, y: 430 },
}

const outflowBand = (n) => {
  if (n < 100) return 'shortage'
  if (n <= 140) return 'normal'
  return 'over'
}
const pctColor = (n) => {
  const band = outflowBand(n)
  if (band === 'over') return 'red'
  if (band === 'normal') return 'green'
  return 'amber'
}

const centerCoordinate = (center) => {
  const code = String(center?.centerCode || '')
  if (CENTER_COORDS[code]) return CENTER_COORDS[code]
  const name = String(center?.centerName || '').replace(/상온센터|센터|\(K7\)|A/g, '')
  const key = Object.keys(CENTER_NAME_COORDS).find((k) => name.includes(k))
  return key ? CENTER_NAME_COORDS[key] : null
}

const parseLoginIdentity = (value) => {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return { name: '담당자', role: 'MD' }
  const titles = ['대표이사', 'Operator', '오퍼레이터', '교수', '학생', '상무', '책임', '수석', '대리', '프로', 'MD']
  const parts = cleaned.split(' ')
  if (parts.length >= 2 && titles.includes(parts[0])) {
    return {
      name: parts.slice(1).join(' '),
      role: parts[0],
    }
  }
  const titleIndex = parts.findIndex((part) => titles.includes(part))
  if (titleIndex > 0) {
    return {
      name: parts.slice(0, titleIndex).join(' '),
      role: parts.slice(titleIndex).join(' '),
    }
  }
  const suffix = titles.find((title) => cleaned.endsWith(title) && cleaned.length > title.length)
  if (suffix) {
    return {
      name: cleaned.slice(0, -suffix.length).trim(),
      role: suffix,
    }
  }
  return { name: cleaned, role: 'MD' }
}

const mapPoint = (coord, width = 720, height = 480) => {
  const minLat = 33.0
  const maxLat = 38.45
  const minLng = 124.8
  const maxLng = 131.0
  const x = ((coord.lng - minLng) / (maxLng - minLng)) * width
  const y = ((maxLat - coord.lat) / (maxLat - minLat)) * height
  return {
    x: Math.max(28, Math.min(width - 28, x)),
    y: Math.max(28, Math.min(height - 28, y)),
  }
}

const fallbackMapPoint = (center, width = 720, height = 480) => {
  const manual = CENTER_MAP_POINTS[String(center?.centerCode || '')]
  if (manual) return manual
  return mapPoint(center.coord, width, height)
}

const loadKakaoMaps = () => {
  if (!KAKAO_MAP_APP_KEY) return Promise.reject(new Error('Offline portfolio demo'))
  if (window.kakao?.maps) {
    return new Promise((resolve) => window.kakao.maps.load(resolve))
  }
  if (window.__sevenKakaoMapPromise) return window.__sevenKakaoMapPromise

  window.__sevenKakaoMapPromise = new Promise((resolve, reject) => {
    const staleScript = document.querySelector('script[data-kakao-map-sdk="true"]')
    if (staleScript && !window.kakao?.maps) staleScript.remove()

    const script = document.createElement('script')
    script.dataset.kakaoMapSdk = 'true'
    script.async = true
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_APP_KEY}&autoload=false`
    script.onload = () => {
      if (!window.kakao?.maps) {
        reject(new Error('Kakao map SDK loaded without maps object'))
        return
      }
      window.kakao.maps.load(resolve)
    }
    script.onerror = () => {
      window.__sevenKakaoMapPromise = null
      reject(new Error('Kakao map SDK load failed'))
    }
    document.head.appendChild(script)
  })

  return window.__sevenKakaoMapPromise
}

function KakaoDemandMap({ item, selectedCenterCode, onSelect }) {
  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapFailed, setMapFailed] = useState(false)

  const centers = useMemo(() => {
    const rows = item?.centers || []
    return rows
      .map((center) => ({ ...center, coord: centerCoordinate(center) }))
      .filter((center) => center.coord)
      .slice()
      .sort((a, b) => Number(b.predictedStores || 0) - Number(a.predictedStores || 0))
  }, [item])

  useEffect(() => {
    const container = mapRef.current
    if (!container || !item || !centers.length) return undefined
    let cancelled = false
    let overlays = []
    let lines = []

    setMapReady(false)
    setMapFailed(false)

    loadKakaoMaps()
      .then(() => {
        if (cancelled || !container || !window.kakao?.maps) return
        try {
          container.innerHTML = ''
          const kakao = window.kakao
          const map = new kakao.maps.Map(container, {
            center: new kakao.maps.LatLng(36.35, 127.9),
            level: 13,
          })
          if (kakao.maps.MapTypeId?.ROADMAP) map.setMapTypeId(kakao.maps.MapTypeId.ROADMAP)
          if (kakao.maps.ZoomControl && kakao.maps.ControlPosition?.RIGHT) {
            map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT)
          }

          const bounds = new kakao.maps.LatLngBounds()
          const southWest = new kakao.maps.LatLng(33.05, 124.85)
          const northEast = new kakao.maps.LatLng(38.35, 130.95)
          bounds.extend(southWest)
          bounds.extend(northEast)
          const hub = new kakao.maps.LatLng(36.35, 127.9)
          const maxPred = Math.max(...centers.map((c) => Number(c.predictedStores || 0)), 1)

          const hubOverlay = new kakao.maps.CustomOverlay({
            position: hub,
            yAnchor: 0.5,
            xAnchor: 0.5,
            content: `<div class="kakao-product-hub"><strong>상품</strong><span>${Number(item?.summary?.predictedStores || 0).toLocaleString()}점포</span></div>`,
          })
          hubOverlay.setMap(map)
          overlays.push(hubOverlay)

          centers.forEach((center) => {
            const position = new kakao.maps.LatLng(center.coord.lat, center.coord.lng)
            bounds.extend(position)
            const tone = Number(center.predictionRatio || 0) > 1.12 ? 'high' : Number(center.predictionRatio || 0) < 0.88 ? 'low' : 'ok'
            const radius = 20 + (Number(center.predictedStores || 0) / maxPred) * 28
            const overlay = new kakao.maps.CustomOverlay({
              position,
              yAnchor: 0.5,
              xAnchor: 0.5,
              content: `
                <button type="button" class="kakao-center-marker ${tone} ${selectedCenterCode === center.centerCode ? 'selected' : ''}" data-center-code="${center.centerCode}" style="width:${radius * 2}px;height:${radius * 2}px">
                  <strong>${center.centerName}</strong>
                  <span>${Number(center.predictedStores || 0).toLocaleString()}점포</span>
                </button>
              `,
            })
            overlay.setMap(map)
            overlays.push(overlay)

            const line = new kakao.maps.Polyline({
              map,
              path: [hub, position],
              strokeWeight: Math.max(2, Math.min(8, (Number(center.predictedStores || 0) / maxPred) * 7)),
              strokeColor: tone === 'high' ? '#dc2626' : tone === 'low' ? '#f97316' : '#0c7a43',
              strokeOpacity: 0.58,
              strokeStyle: 'solid',
            })
            lines.push(line)
          })

          map.setBounds(bounds)
          window.setTimeout(() => {
            if (cancelled || !container) return
            container.querySelectorAll('[data-center-code]').forEach((node) => {
              node.addEventListener('click', () => onSelect?.(node.getAttribute('data-center-code')))
            })
          }, 0)
          setMapReady(true)
          setMapFailed(false)
        } catch {
          setMapReady(false)
          setMapFailed(true)
        }
      })
      .catch(() => {
        if (cancelled) return
        setMapReady(false)
        setMapFailed(true)
      })

    return () => {
      cancelled = true
      overlays.forEach((overlay) => overlay.setMap?.(null))
      lines.forEach((line) => line.setMap?.(null))
      overlays = []
      lines = []
    }
  }, [centers, item, onSelect, selectedCenterCode])

  const maxPred = Math.max(...centers.map((c) => Number(c.predictedStores || 0)), 1)
  const maxActual = Math.max(...centers.map((c) => Number(c.actualStores || 0)), 1)

  return (
    <div className="kakao-network-shell">
      <div className="kakao-map-canvas" ref={mapRef}>
        {!mapReady && !mapFailed && (
          <div className="kakao-map-loading">
            <strong>카카오맵 남한 지도 불러오는 중</strong>
            <span>센터 위치와 예측 참여점포를 지도 위에 표시합니다.</span>
          </div>
        )}
        {mapFailed && (
          <svg className="fallback-korea-map" viewBox="0 0 720 480" role="img" aria-label={`${item?.itemName || '상품'} 센터 수요 지도`}>
            <defs>
              <linearGradient id="fallbackLand" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#e8f7ee" />
                <stop offset="1" stopColor="#f8fafc" />
              </linearGradient>
            </defs>
            <path className="fallback-land" d="M325 35C390 57 420 117 440 178c31 95 112 118 117 190 4 57-42 92-96 87-56-5-88-44-142-55-63-13-111 18-157-18-43-34-39-97-16-143 28-56 29-108 72-153 28-30 63-64 107-51Z" />
            <circle className="fallback-hub" cx="355" cy="222" r="34" />
            <text x="355" y="216" textAnchor="middle" className="fallback-hub-title">상품</text>
            <text x="355" y="236" textAnchor="middle" className="fallback-hub-sub">{Number(item?.summary?.predictedStores || 0).toLocaleString()}점포 예측</text>
            {centers.map((center) => {
              const { x, y } = fallbackMapPoint(center)
              const tone = Number(center.predictionRatio || 0) > 1.12 ? 'high' : Number(center.predictionRatio || 0) < 0.88 ? 'low' : 'ok'
              const r = 8 + (Number(center.predictedStores || 0) / maxPred) * 14
              const selected = selectedCenterCode === center.centerCode
              const labelOnLeft = x > 540
              const labelX = labelOnLeft ? x - r - 8 : x + r + 8
              const labelAnchor = labelOnLeft ? 'end' : 'start'
              return (
                <g
                  key={`fallback-map-${center.centerCode}`}
                  className={`fallback-center ${tone} ${selected ? 'selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect?.(center.centerCode)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelect?.(center.centerCode)
                  }}
                >
                  <line x1="355" y1="222" x2={x} y2={y} strokeWidth={Math.max(1.6, (Number(center.predictedStores || 0) / maxPred) * 5)} />
                  <circle cx={x} cy={y} r={r} />
                  <text x={labelX} y={y - 3} textAnchor={labelAnchor}>{center.centerName}</text>
                  <text x={labelX} y={y + 13} textAnchor={labelAnchor} className="fallback-center-sub">{Number(center.predictedStores || 0).toLocaleString()}점포</text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <div className="kakao-map-summary">
        <div>
          <small>지도 해석</small>
          <strong>상품에서 센터로 뻗는 선이 굵을수록 예측 참여 점포가 많습니다.</strong>
        </div>
        <div className="map-chip-row">
          <span><i className="ok" />정상권</span>
          <span><i className="low" />과소 예측</span>
          <span><i className="high" />과대 예측</span>
        </div>
      </div>
      <div className="map-center-strip">
        {centers.slice(0, 8).map((center) => {
          const predictedWidth = Math.max(4, Math.min(100, (Number(center.predictedStores || 0) / maxPred) * 100))
          const actualWidth = Math.max(4, Math.min(100, (Number(center.actualStores || 0) / maxActual) * 100))
          return (
            <button
              type="button"
              key={`map-strip-${center.centerCode}`}
              className={selectedCenterCode === center.centerCode ? 'selected' : ''}
              onClick={() => onSelect?.(center.centerCode)}
            >
              <span>{center.centerName}</span>
              <i><b className="predicted" style={{ width: `${predictedWidth}%` }} /><b className="actual" style={{ width: `${actualWidth}%` }} /></i>
              <strong>{Number(center.predictedStores || 0).toLocaleString()} / {Number(center.actualStores || 0).toLocaleString()}점포</strong>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState('금주+MD')
  const [data, setData] = useState(null)
  const [gnnData, setGnnData] = useState(null)
  const [lifecycleData, setLifecycleData] = useState(null)
  const [qtyMap, setQtyMap] = useState({})
  const [centerQtyMap, setCenterQtyMap] = useState({})
  const [centerWeightMap, setCenterWeightMap] = useState({})
  const [confirmedMap, setConfirmedMap] = useState({})
  const [selectedItemCode, setSelectedItemCode] = useState('')
  const [drawerDetailTab, setDrawerDetailTab] = useState('basic')
  const [currentDate, setCurrentDate] = useState(FIXED_DECISION_DATE)
  const [pastCategory, setPastCategory] = useState('전체')
  const [pastCategoryMid, setPastCategoryMid] = useState('전체')
  const [pastCategorySub, setPastCategorySub] = useState('전체')
  const [pastSort, setPastSort] = useState('latest')
  const [pastDateFrom, setPastDateFrom] = useState('')
  const [pastDateTo, setPastDateTo] = useState('')
  const [pastQuery, setPastQuery] = useState('')
  const [pastExpandedKey, setPastExpandedKey] = useState('')
  const [gnnQuery, setGnnQuery] = useState('')
  const [selectedGnnItemCode, setSelectedGnnItemCode] = useState('')
  const [selectedGnnCenterCode, setSelectedGnnCenterCode] = useState('')
  const [lifecycleQuery, setLifecycleQuery] = useState('')
  const [selectedLifecycleItemCode, setSelectedLifecycleItemCode] = useState('')
  const [chartTooltip, setChartTooltip] = useState(null)
  const [decisionNoteMap, setDecisionNoteMap] = useState({})
  const [similarExpandedMap, setSimilarExpandedMap] = useState({})
  const [reservationCenterMap, setReservationCenterMap] = useState({})
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [calcBox, setCalcBox] = useState('100')
  const [calcLdu, setCalcLdu] = useState('20')
  const [calcRecommendedBox, setCalcRecommendedBox] = useState('100')
  const [calcTargetEa, setCalcTargetEa] = useState('2000')
  const [isLoggedIn, setIsLoggedIn] = useState(() => window.sessionStorage.getItem('sevenMdLoggedIn') === '1')
  const [loginId, setLoginId] = useState(() => window.sessionStorage.getItem('sevenMdLoginInput') || '')
  const [mdProfile, setMdProfile] = useState(() => parseLoginIdentity(window.sessionStorage.getItem('sevenMdLoginInput') || ''))
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const mdDisplayName = `${mdProfile.name} ${mdProfile.role}님`

  useEffect(() => {
    setDrawerDetailTab('basic')
    if (selectedItemCode) setCalculatorOpen(false)
  }, [selectedItemCode])

  useEffect(() => {
    if (!selectedItemCode || activeTab !== '금주+MD') return undefined
    const timer = window.setTimeout(() => {
      document.querySelector('.today-inline-expand')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [selectedItemCode, activeTab])

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/dashboard-data.json`)
      .then((res) => res.json())
      .then((json) => {
        setData(json)
        const initRows = json.allRows || []
        setQtyMap(
          Object.fromEntries(
            initRows.map((r) => {
              const ldu = boxUnitEa(r)
              const recoEa = Number(r.mlRecommendQty || r.recommendQty || r.inputQty || 0)
              return [r.rowKey, String(Math.round(recoEa / ldu))]
            }),
          ),
        )
      })
  }, [])

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/gnn-network.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json) return
        setGnnData(json)
        setSelectedGnnItemCode((prev) => prev || json.items?.[0]?.itemCode || '')
      })
      .catch(() => {
        setGnnData(null)
      })
  }, [])

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/lifecycle-data.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json) return
        setLifecycleData(json)
        setSelectedLifecycleItemCode((prev) => prev || json.items?.[0]?.itemCode || '')
      })
      .catch(() => {
        setLifecycleData(null)
      })
  }, [])

  const reservationDates = [
    ...new Set(
      Object.values(data?.itemDetails || {})
        .flatMap((d) => d.reservation4d?.map((p) => p.date) || [])
        .filter(Boolean),
    ),
  ].sort()
  const minDate = reservationDates[0] || ''
  const maxDate = reservationDates[reservationDates.length - 1] || ''
  const selectedBaseDate = FIXED_DECISION_DATE
  const baseRows = data?.allRows ?? []
  const deadlineDates = baseRows.map((r) => r.deadlineDate).filter(Boolean).sort()
  const minDeadlineDate = deadlineDates[0] || ''
  const maxDeadlineDate = deadlineDates[deadlineDates.length - 1] || ''
  const weeklyRows = baseRows.filter((r) => {
    const detail = data?.itemDetails?.[r.rowKey]
    const reservation4d = detail?.reservation4d || []
    const hasDecisionData =
      reservation4d.length === 7 &&
      reservation4d.every((p) => Number(p.qty || 0) >= 0)
    const isDeadlineDay = (r.deadlineDate || '') === selectedBaseDate
    return hasDecisionData && isDeadlineDay
  })
  const pastRows = useMemo(() => data?.pastRows ?? [], [data])
  const pastRowsWithKey = useMemo(
    () => pastRows.map((r) => ({ ...r, rowKey: r.rowKey || `${r.itemCode}_${r.releaseDate}` })),
    [pastRows],
  )
  const pastCategoryOptions = useMemo(
    () => ['전체', ...Array.from(new Set(pastRowsWithKey.map((r) => r.category).filter(Boolean))).sort()],
    [pastRowsWithKey],
  )
  const pastCategoryMidOptions = useMemo(() => {
    const rows = pastRowsWithKey.filter((r) => pastCategory === '전체' || r.category === pastCategory)
    return ['전체', ...Array.from(new Set(rows.map((r) => r.categoryMid).filter(Boolean))).sort()]
  }, [pastRowsWithKey, pastCategory])
  const pastCategorySubOptions = useMemo(() => {
    const rows = pastRowsWithKey
      .filter((r) => pastCategory === '전체' || r.category === pastCategory)
      .filter((r) => pastCategoryMid === '전체' || r.categoryMid === pastCategoryMid)
    return ['전체', ...Array.from(new Set(rows.map((r) => r.categorySub).filter(Boolean))).sort()]
  }, [pastRowsWithKey, pastCategory, pastCategoryMid])
  const filteredPastRows = useMemo(() => {
    const rows = pastRowsWithKey
      .filter((r) => pastCategory === '전체' || r.category === pastCategory)
      .filter((r) => pastCategoryMid === '전체' || r.categoryMid === pastCategoryMid)
      .filter((r) => pastCategorySub === '전체' || r.categorySub === pastCategorySub)
      .filter((r) => !pastDateFrom || (r.releaseDate || '') >= pastDateFrom)
      .filter((r) => !pastDateTo || (r.releaseDate || '') <= pastDateTo)
      .filter((r) => {
        const q = pastQuery.trim().toLowerCase()
        if (!q) return true
        return (
          String(r.itemName || '').toLowerCase().includes(q) ||
          String(r.itemCode || '').toLowerCase().includes(q)
        )
      })
    const sorted = [...rows]
    if (pastSort === 'high_rate') sorted.sort((a, b) => Number(b.salesRate) - Number(a.salesRate))
    else if (pastSort === 'low_rate') sorted.sort((a, b) => Number(a.salesRate) - Number(b.salesRate))
    else if (pastSort === 'high_qty') sorted.sort((a, b) => Number(b.actualOrderQty) - Number(a.actualOrderQty))
    else sorted.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
    return sorted
  }, [pastRowsWithKey, pastCategory, pastCategoryMid, pastCategorySub, pastDateFrom, pastDateTo, pastSort, pastQuery])

  const filteredRows = useMemo(() => weeklyRows, [weeklyRows])

  const confirmedCount = Object.values(confirmedMap).filter(Boolean).length
  const newItemCount = new Set(weeklyRows.map((r) => r.itemCode)).size
  const gnnItems = gnnData?.items ?? []
  const gnnItemByCode = useMemo(
    () => new Map(gnnItems.map((item) => [String(item.itemCode), item])),
    [gnnItems],
  )
  const gnnTargetStoreCount = useMemo(() => {
    const counts = gnnItems.flatMap((item) => [
      Number(item.summary?.actualStores || 0),
      Number(item.summary?.predictedStores || 0),
    ])
    return Math.max(...counts, 0)
  }, [gnnItems])
  const gnnIntroStats = useMemo(() => {
    const rowsByCode = new Map()
    pastRowsWithKey.forEach((row) => {
      const code = String(row.itemCode || '')
      if (code && !rowsByCode.has(code)) rowsByCode.set(code, row)
    })

    const buckets = new Map()
    const push = (key, rate, stores) => {
      if (!key || !Number.isFinite(rate)) return
      const prev = buckets.get(key) || { rateSum: 0, storesSum: 0, count: 0 }
      prev.rateSum += rate
      prev.storesSum += stores
      prev.count += 1
      buckets.set(key, prev)
    }

    if (!gnnTargetStoreCount) return buckets
    gnnItems.forEach((item) => {
      const row = rowsByCode.get(String(item.itemCode || ''))
      const predictedStores = Number(item.summary?.predictedStores || 0)
      if (!row || !predictedStores) return
      const rate = (predictedStores / gnnTargetStoreCount) * 100
      push([row.category, row.categoryMid, row.categorySub].filter(Boolean).join('>'), rate, predictedStores)
      push([row.category, row.categoryMid].filter(Boolean).join('>'), rate, predictedStores)
      push([row.category].filter(Boolean).join('>'), rate, predictedStores)
    })
    return buckets
  }, [gnnItems, gnnTargetStoreCount, pastRowsWithKey])
  const predictedIntroInfo = (row) => {
    if (!row || !gnnTargetStoreCount) return null
    const direct = gnnItemByCode.get(String(row.itemCode || ''))
    if (direct?.summary?.predictedStores) {
      const predictedStores = Number(direct.summary.predictedStores || 0)
      return {
        rate: Math.round((predictedStores / gnnTargetStoreCount) * 1000) / 10,
        source: '예측',
        stores: predictedStores,
        targetStores: gnnTargetStoreCount,
        count: 1,
      }
    }

    const keys = [
      [row.category, row.categoryMid, row.categorySub].filter(Boolean).join('>'),
      [row.category, row.categoryMid].filter(Boolean).join('>'),
      [row.category].filter(Boolean).join('>'),
    ]
    const matched = keys.map((key) => gnnIntroStats.get(key)).find((stat) => stat?.count)
    if (!matched) return null
    const stores = Math.round(matched.storesSum / matched.count)
    return {
      rate: Math.round((matched.rateSum / matched.count) * 10) / 10,
      source: '예측',
      stores,
      targetStores: gnnTargetStoreCount,
      count: matched.count,
    }
  }
  const predictedIntroTone = (row, intro) => {
    if (!intro) return ''
    const goal = Number(row.goalIntroRate || 0)
    if (!goal) return 'neutral'
    const diff = intro.rate - goal
    if (diff <= -5) return 'low'
    if (diff >= 5) return 'high'
    return 'ok'
  }
  const filteredGnnItems = useMemo(() => {
    const q = gnnQuery.trim().toLowerCase()
    const rows = q
      ? gnnItems.filter((item) => (
        String(item.itemName || '').toLowerCase().includes(q) ||
        String(item.itemCode || '').toLowerCase().includes(q)
      ))
      : gnnItems
    return rows.slice(0, 80)
  }, [gnnItems, gnnQuery])
  const selectedGnnItem = useMemo(() => {
    if (!gnnItems.length) return null
    return (
      gnnItems.find((item) => item.itemCode === selectedGnnItemCode) ||
      filteredGnnItems[0] ||
      gnnItems[0]
    )
  }, [gnnItems, selectedGnnItemCode, filteredGnnItems])
  const selectedGnnCenter = useMemo(() => {
    const centers = selectedGnnItem?.centers || []
    if (!centers.length) return null
    return centers.find((center) => center.centerCode === selectedGnnCenterCode) || centers[0]
  }, [selectedGnnItem, selectedGnnCenterCode])
  const lifecycleItems = lifecycleData?.items ?? []
  const lifecycleItemByCode = useMemo(
    () => new Map(lifecycleItems.map((item) => [String(item.itemCode), item])),
    [lifecycleItems],
  )
  const filteredLifecycleItems = useMemo(() => {
    const q = lifecycleQuery.trim().toLowerCase()
    const rows = q
      ? lifecycleItems.filter((item) => (
        String(item.itemName || '').toLowerCase().includes(q) ||
        String(item.itemCode || '').toLowerCase().includes(q)
      ))
      : lifecycleItems
    return rows.slice(0, 80)
  }, [lifecycleItems, lifecycleQuery])
  const selectedLifecycleItem = useMemo(() => {
    if (!lifecycleItems.length) return null
    return (
      lifecycleItems.find((item) => item.itemCode === selectedLifecycleItemCode) ||
      filteredLifecycleItems[0] ||
      lifecycleItems[0]
    )
  }, [lifecycleItems, selectedLifecycleItemCode, filteredLifecycleItems])
  const gnnTone = (center) => {
    const ratio = Number(center?.predictionRatio || 0)
    if (!ratio) return 'neutral'
    if (ratio > 1.15) return 'high'
    if (ratio < 0.85) return 'low'
    return 'ok'
  }
  const gnnToneLabel = (center) => {
    const tone = gnnTone(center)
    if (tone === 'high') return '과대 예측'
    if (tone === 'low') return '과소 예측'
    if (tone === 'ok') return '예측 적정'
    return '비교 대기'
  }

  const buildLinePath = (points, width, height, pad, bounds = null) => {
    const max = bounds?.max ?? Math.max(...points.map((p) => p.qty), 1)
    const min = bounds?.min ?? Math.min(...points.map((p) => p.qty), 0)
    const range = Math.max(max - min, 1)
    const stepX = (width - pad * 2) / Math.max(points.length - 1, 1)
    return points
      .map((p, idx) => {
        const x = pad + stepX * idx
        const y = height - pad - ((p.qty - min) / range) * (height - pad * 2)
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')
  }
  const pointXY = (point, idx, points, width, height, pad, bounds = null) => {
    const max = bounds?.max ?? Math.max(...points.map((p) => p.qty), 1)
    const min = bounds?.min ?? Math.min(...points.map((p) => p.qty), 0)
    const range = Math.max(max - min, 1)
    const stepX = (width - pad * 2) / Math.max(points.length - 1, 1)
    const x = pad + stepX * idx
    const y = height - pad - ((point.qty - min) / range) * (height - pad * 2)
    return { x, y }
  }
  const buildAreaPath = (points, width, height, pad, bounds = null) => {
    if (!points.length) return ''
    const max = bounds?.max ?? Math.max(...points.map((p) => p.qty), 1)
    const min = bounds?.min ?? Math.min(...points.map((p) => p.qty), 0)
    const range = Math.max(max - min, 1)
    const stepX = (width - pad * 2) / Math.max(points.length - 1, 1)
    const toXY = (p, idx) => {
      const x = pad + stepX * idx
      const y = height - pad - ((p.qty - min) / range) * (height - pad * 2)
      return [x, y]
    }
    const first = toXY(points[0], 0)
    const last = toXY(points[points.length - 1], points.length - 1)
    const line = points
      .map((p, idx) => {
        const [x, y] = toXY(p, idx)
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`
      })
      .join(' ')
    return `${line} L ${last[0]} ${height - pad} L ${first[0]} ${height - pad} Z`
  }
  const formatMd = (dateText) => {
    if (!dateText) return ''
    const parts = String(dateText).split('-')
    if (parts.length < 3) return dateText
    return `${parts[1]}/${parts[2]}`
  }
  const chartGrid = (width, height, pad, prefix) => (
    <>
      {[0.25, 0.5, 0.75].map((ratio) => {
        const y = pad + (height - pad * 2) * ratio
        return (
          <line
            key={`${prefix}-${ratio}`}
            className="chart-grid-line"
            x1={pad}
            x2={width - pad}
            y1={y}
            y2={y}
          />
        )
      })}
    </>
  )
  const boxUnitEa = (row) => Math.max(Number(row?.boxUnitEa || row?.obObtQy || row?.lduEa || 1), 1)
  const toEaFromBox = (boxQty, unitEa) => Math.round(Number(boxQty || 0) * Math.max(Number(unitEa || 1), 1))
  const mlRecommendEa = (row) => Number(row.mlRecommendQty || row.recommendQty || 0)
  const mlRecommendBox = (row) => Math.round(mlRecommendEa(row) / boxUnitEa(row))
  const currentInputEa = (row) => toEaFromBox(qtyMap[row.rowKey], boxUnitEa(row))
  const currentInputBox = (row) => Number(qtyMap[row.rowKey] || 0)
  const qtyDeltaTone = (row) => {
    const input = currentInputBox(row)
    const reco = mlRecommendBox(row)
    if (reco <= 0) return ''
    const ratio = input / reco
    if (ratio > 1.1) return 'high'
    if (ratio < 0.9) return 'low'
    return 'ok'
  }
  const currentOutflowRate = (row) => {
    const recoEa = Math.max(mlRecommendEa(row), 1)
    const input = Math.max(currentInputEa(row), 1)
    return Math.max(0, Math.round((input / recoEa) * 1000) / 10)
  }
  const riskItemCount = filteredRows.filter((r) => {
    const rate = currentOutflowRate(r)
    return rate < 100 || rate > 140
  }).length
  const defaultCenterWeights = (row) => {
    const detail = data?.itemDetails?.[row.rowKey]
    const centers = detail?.centerDistribution || []
    return Object.fromEntries(centers.map((c) => [c.centerName, Number(c.centerWeight || 1)]))
  }
  const weightedCentersByBox = (row) => {
    const detail = data?.itemDetails?.[row.rowKey]
    const centers = detail?.centerDistribution || []
    const targetBox = Math.max(currentInputBox(row), 0)
    const forwardCenters = detail?.forwardPrediction?.centers || []
    const forwardByName = new Map(forwardCenters.map((c) => [c.centerName, c]))
    const displayForwardCenters = centers.length
      ? centers.map((c) => ({ ...c, ...(forwardByName.get(c.centerName) || {}), recommendedBox: Number(forwardByName.get(c.centerName)?.recommendedBox || 0) }))
      : forwardCenters
    const forwardBoxSum = displayForwardCenters.reduce((acc, c) => acc + Number(c.recommendedBox || 0), 0)
    if (displayForwardCenters.length && forwardBoxSum > 0) {
      const scale = targetBox > 0 ? targetBox / forwardBoxSum : 0
      let scaled = displayForwardCenters.map((c) => {
        const raw = Number(c.recommendedBox || 0) * scale
        const floor = Math.floor(raw)
        return { centerName: c.centerName, floor, frac: raw - floor }
      })
      let remain = targetBox - scaled.reduce((acc, c) => acc + c.floor, 0)
      scaled = scaled.sort((a, b) => b.frac - a.frac)
      for (let i = 0; i < scaled.length && remain > 0; i += 1, remain -= 1) scaled[i].floor += 1
      return scaled
        .sort((a, b) => a.centerName.localeCompare(b.centerName, 'ko'))
        .map((c) => ({ centerName: c.centerName, qty: c.floor }))
    }
    if (!centers.length) return []
    const weights = centerWeightMap[row.rowKey] || defaultCenterWeights(row)
    const indexed = centers.map((c) => {
      const storeShare = Number(c.storeShare || 0)
      const w = Math.max(Number(weights[c.centerName] || 0), 0)
      return { ...c, index: storeShare * w }
    })
    const indexSum = indexed.reduce((acc, c) => acc + c.index, 0)
    if (indexSum <= 0) return centers.map((c) => ({ centerName: c.centerName, qty: 0 }))

    const scaled = indexed.map((c) => {
      const raw = (c.index / indexSum) * targetBox
      const floor = Math.floor(raw)
      return { centerName: c.centerName, floor, frac: raw - floor }
    })
    let remain = targetBox - scaled.reduce((acc, c) => acc + c.floor, 0)
    scaled.sort((a, b) => b.frac - a.frac)
    for (let i = 0; i < scaled.length && remain > 0; i += 1, remain -= 1) scaled[i].floor += 1
    return scaled
      .sort((a, b) => a.centerName.localeCompare(b.centerName, 'ko'))
      .map((c) => ({ centerName: c.centerName, qty: c.floor }))
  }
  const recommendedCentersByBox = (row) => {
    const detail = data?.itemDetails?.[row.rowKey]
    const centers = detail?.centerDistribution || []
    const targetBox = Math.max(mlRecommendBox(row), 0)
    const forwardCenters = detail?.forwardPrediction?.centers || []
    const forwardByName = new Map(forwardCenters.map((c) => [c.centerName, c]))
    const displayForwardCenters = centers.length
      ? centers.map((c) => ({ ...c, ...(forwardByName.get(c.centerName) || {}), recommendedBox: Number(forwardByName.get(c.centerName)?.recommendedBox || 0) }))
      : forwardCenters
    const forwardBoxSum = displayForwardCenters.reduce((acc, c) => acc + Number(c.recommendedBox || 0), 0)
    if (displayForwardCenters.length && forwardBoxSum > 0) {
      const scale = targetBox > 0 ? targetBox / forwardBoxSum : 0
      let scaled = displayForwardCenters.map((c) => {
        const raw = Number(c.recommendedBox || 0) * scale
        const floor = Math.floor(raw)
        return { centerName: c.centerName, floor, frac: raw - floor }
      })
      let remain = targetBox - scaled.reduce((acc, c) => acc + c.floor, 0)
      scaled = scaled.sort((a, b) => b.frac - a.frac)
      for (let i = 0; i < scaled.length && remain > 0; i += 1, remain -= 1) scaled[i].floor += 1
      return scaled
        .sort((a, b) => a.centerName.localeCompare(b.centerName, 'ko'))
        .map((c) => ({ centerName: c.centerName, qty: c.floor }))
    }
    if (!centers.length) return []
    const weights = centerWeightMap[row.rowKey] || defaultCenterWeights(row)
    const indexed = centers.map((c) => {
      const storeShare = Number(c.storeShare || 0)
      const w = Math.max(Number(weights[c.centerName] || 0), 0)
      return { ...c, index: storeShare * w }
    })
    const indexSum = indexed.reduce((acc, c) => acc + c.index, 0)
    if (indexSum <= 0) return centers.map((c) => ({ centerName: c.centerName, qty: 0 }))

    const scaled = indexed.map((c) => {
      const raw = (c.index / indexSum) * targetBox
      const floor = Math.floor(raw)
      return { centerName: c.centerName, floor, frac: raw - floor }
    })
    let remain = targetBox - scaled.reduce((acc, c) => acc + c.floor, 0)
    scaled.sort((a, b) => b.frac - a.frac)
    for (let i = 0; i < scaled.length && remain > 0; i += 1, remain -= 1) scaled[i].floor += 1
    return scaled
      .sort((a, b) => a.centerName.localeCompare(b.centerName, 'ko'))
      .map((c) => ({ centerName: c.centerName, qty: c.floor }))
  }
  const baseCenterBoxMap = (row) =>
    Object.fromEntries(
      recommendedCentersByBox(row).map((c) => [
        c.centerName,
        Number(c.qty || 0),
      ]),
    )

  const centerTone = (row, centerName, currentBox) => {
    const baseBox = Number(baseCenterBoxMap(row)[centerName] || 0)
    if (baseBox <= 0) return ''
    const ratio = Number(currentBox || 0) / baseBox
    if (ratio > 1.1) return 'high'
    if (ratio < 0.9) return 'low'
    return 'ok'
  }
  const centersForRow = (row) => {
    const baseCenters = weightedCentersByBox(row)
    const manual = centerQtyMap[row.rowKey]
    if (manual) {
      const baseNames = new Set(baseCenters.map((c) => c.centerName))
      const merged = baseCenters.map((c) => ({
        centerName: c.centerName,
        qty: Number(manual[c.centerName] ?? c.qty ?? 0),
      }))
      Object.entries(manual).forEach(([centerName, qty]) => {
        if (!baseNames.has(centerName)) merged.push({ centerName, qty: Number(qty || 0) })
      })
      return merged
    }
    return baseCenters
  }
  const updateCenterBoxQty = (row, centers, centerName, nextBox) => {
    const cleanBox = Math.max(0, Math.round(Number(nextBox || 0)))
    setCenterQtyMap((prev) => {
      const current = prev[row.rowKey] || Object.fromEntries(centers.map((x) => [x.centerName, String(x.qty)]))
      const updated = { ...current, [centerName]: String(cleanBox) }
      const totalBox = Object.values(updated).reduce((acc, v) => acc + Number(v || 0), 0)
      setQtyMap((qm) => ({ ...qm, [row.rowKey]: String(totalBox) }))
      return { ...prev, [row.rowKey]: updated }
    })
    setConfirmedMap((prev) => ({ ...prev, [row.rowKey]: false }))
  }
  const updateCenterBoxFromPointer = (event, row, centers, centerName, dragMaxBox) => {
    event.stopPropagation()
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    updateCenterBoxQty(row, centers, centerName, ratio * dragMaxBox)
  }
  const resetCenterToRecommended = (row, centers, centerName) => {
    const baseBox = Number(baseCenterBoxMap(row)[centerName] || 0)
    updateCenterBoxQty(row, centers, centerName, baseBox)
  }
  const resetOrderToRecommended = (row) => {
    setQtyMap((prev) => ({ ...prev, [row.rowKey]: String(mlRecommendBox(row)) }))
    setCenterQtyMap((prev) => ({ ...prev, [row.rowKey]: undefined }))
    setConfirmedMap((prev) => ({ ...prev, [row.rowKey]: false }))
  }
  const excelEscape = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  const safeFileName = (value) =>
    String(value || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  const exportCenterAllocations = () => {
    const confirmedRows = filteredRows.filter((row) => confirmedMap[row.rowKey])
    const rowsToExport = confirmedRows.length ? confirmedRows : filteredRows
    if (!rowsToExport.length) return
    const allocationRows = rowsToExport.flatMap((row) => {
      const centers = centersForRow(row)
      const baseBoxes = baseCenterBoxMap(row)
      const ldu = boxUnitEa(row)
      const totalBox = centers.reduce((acc, c) => acc + Number(c.qty || 0), 0)
      return centers.map((c) => {
        const recommendedBox = Number(baseBoxes[c.centerName] || 0)
        const confirmedBox = Number(c.qty || 0)
        const deltaBox = confirmedBox - recommendedBox
        const tone = centerTone(row, c.centerName, confirmedBox)
        const status = tone === 'high' ? '과발주 주의' : tone === 'low' ? '결품 주의' : '권장 범위'
        return {
          itemCode: row.itemCode,
          itemName: row.itemName,
          category: row.category,
          categoryMid: row.categoryMid || '',
          categorySub: row.categorySub || '',
          ldu,
          totalBox,
          totalEa: toEaFromBox(totalBox, ldu),
          centerName: c.centerName,
          recommendedBox,
          confirmedBox,
          confirmedEa: toEaFromBox(confirmedBox, ldu),
          deltaBox,
          status,
          note: decisionNoteMap[row.rowKey] || '모델 추천 그대로',
          confirmed: confirmedMap[row.rowKey] ? '확정 완료' : '미확정',
        }
      })
    })
    const htmlRows = allocationRows.map((r) => `
      <tr>
        <td>${excelEscape(r.confirmed)}</td>
        <td>${excelEscape(r.itemCode)}</td>
        <td>${excelEscape(r.itemName)}</td>
        <td>${excelEscape(r.category)}</td>
        <td>${excelEscape(r.categoryMid)}</td>
        <td>${excelEscape(r.categorySub)}</td>
        <td>${excelEscape(r.centerName)}</td>
        <td style="mso-number-format:'0';">${r.recommendedBox}</td>
        <td style="mso-number-format:'0';">${r.confirmedBox}</td>
        <td style="mso-number-format:'0';">${r.confirmedEa}</td>
        <td style="mso-number-format:'0';">${r.deltaBox}</td>
        <td>${excelEscape(r.status)}</td>
        <td>${excelEscape(r.note)}</td>
      </tr>
    `).join('')
    const exportedItemCount = new Set(allocationRows.map((r) => r.itemCode)).size
    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            body { font-family: Arial, sans-serif; }
            h2 { margin: 0 0 8px; }
            p { margin: 2px 0 10px; color: #334155; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; }
            th { background: #f1f5f9; font-weight: 700; }
          </style>
        </head>
        <body>
          <h2>센터별 발주 배분 수량</h2>
          <p>현재 날짜: ${excelEscape(selectedBaseDate || currentDate || '')} / 상품 수: ${exportedItemCount.toLocaleString()}개 / 기준: ${confirmedRows.length ? '확정 완료 상품' : '현재 조회 상품 전체'}</p>
          <table>
            <thead>
              <tr>
                <th>확정 상태</th>
                <th>상품코드</th>
                <th>상품명</th>
                <th>대분류</th>
                <th>중분류</th>
                <th>소분류</th>
                <th>센터명</th>
                <th>모델 권장 박스</th>
                <th>확정 박스</th>
                <th>확정 EA</th>
                <th>권장 대비 박스</th>
                <th>센터 상태</th>
                <th>MD 조정 사유</th>
              </tr>
            </thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </body>
      </html>
    `
    const blob = new Blob(['\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `센터별_발주배분_${confirmedRows.length ? '확정상품' : '조회상품'}_${selectedBaseDate || currentDate || 'date'}.xls`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  const reviewReasons = (row) => {
    const reasons = []
    const rate = currentOutflowRate(row)
    const detail = data?.itemDetails?.[row.rowKey] || {}
    const evidence = detail.recommendationEvidence || {}
    const similarRate = Number(evidence.similarAvgAdequacyRate || 0)
    const frontload = Number(evidence.frontloadRatio || 0)
    const centerTones = centersForRow(row).map((c) => centerTone(row, c.centerName, c.qty))
    if (rate < 100) reasons.push({ tone: 'low', label: '결품위험' })
    if (rate > 140) reasons.push({ tone: 'high', label: '과발주' })
    if (similarRate > 140) reasons.push({ tone: 'high', label: '유사 과발주' })
    if (similarRate > 0 && similarRate < 100) reasons.push({ tone: 'low', label: '유사 결품' })
    if (frontload >= 70) reasons.push({ tone: 'ok', label: '초반 집중' })
    if (centerTones.includes('high') || centerTones.includes('low')) reasons.push({ tone: 'diff', label: '센터 조정' })
    return reasons.slice(0, 4)
  }
  const orderDeltaSummary = (row) => {
    const recoBox = mlRecommendBox(row)
    const inputBox = currentInputBox(row)
    const deltaBox = inputBox - recoBox
    const ldu = boxUnitEa(row)
    const ratio = recoBox > 0 ? (inputBox / recoBox) * 100 : 0
    const tone = deltaBox > 0 ? 'high' : deltaBox < 0 ? 'low' : 'ok'
    return {
      recoBox,
      inputBox,
      deltaBox,
      deltaEa: deltaBox * ldu,
      ratio,
      tone,
    }
  }
  const weeklyQueue = useMemo(() => {
    const centerNeeds = filteredRows.filter((r) =>
      centersForRow(r).some((c) => ['high', 'low'].includes(centerTone(r, c.centerName, c.qty))),
    )
    const reasonSets = filteredRows.map((r) => reviewReasons(r))
    const hasReason = (rowReasons, predicate) => rowReasons.some(predicate)
    const straight = filteredRows.filter((r) => {
      const rate = currentOutflowRate(r)
      const hasReviewRisk = reviewReasons(r).some((reason) => ['high', 'low'].includes(reason.tone))
      return rate >= 100 && rate <= 140 && !hasReviewRisk && !centerNeeds.some((x) => x.rowKey === r.rowKey)
    })
    const breakdown = {
      over: reasonSets.filter((reasons) => hasReason(reasons, (reason) => reason.label.includes('과발주'))).length,
      shortage: reasonSets.filter((reasons) => hasReason(reasons, (reason) => reason.label.includes('결품'))).length,
      similar: reasonSets.filter((reasons) => hasReason(reasons, (reason) => reason.label.startsWith('유사'))).length,
      frontload: reasonSets.filter((reasons) => hasReason(reasons, (reason) => reason.label === '초반 집중')).length,
    }
    return {
      total: filteredRows.length,
      review: filteredRows.filter((r) => reviewReasons(r).some((reason) => ['high', 'low'].includes(reason.tone))).length,
      straight: straight.length,
      centerNeeds: centerNeeds.length,
      breakdown,
    }
  }, [filteredRows, qtyMap, centerQtyMap, centerWeightMap, data])
  const buildMdReasonPayload = (row, evidence = {}) => {
    const detail = data?.itemDetails?.[row.rowKey] || {}
    const ldu = boxUnitEa(row)
    const reservation = detail.reservation4d || []
    const reservationSum = Number(evidence.reservationDecisionSum || reservation.reduce((acc, p) => acc + Number(p.qty || 0), 0))
    const first4 = Number(evidence.reservationInitial4Sum || 0)
    const frontloadRatio = Number(evidence.frontloadRatio || (reservationSum > 0 ? (first4 / reservationSum) * 100 : 0))
    const similarAvgOrder = Number(evidence.similarAvgOrderQty || 0)
    const similarAvgRate = Number(evidence.similarAvgAdequacyRate || 0)
    const centerMeta = Object.fromEntries((detail.centerDistribution || []).map((c) => [c.centerName, c]))
    const recommendedMap = baseCenterBoxMap(row)
    const centers = centersForRow(row)
      .map((c) => {
        const meta = centerMeta[c.centerName] || {}
        const recommendedBox = Number(recommendedMap[c.centerName] || 0)
        const inputBox = Number(c.qty || 0)
        return {
          centerName: c.centerName,
          recommendedBox,
          inputBox,
          inputEa: inputBox * ldu,
          storeSharePct: Math.round(Number(meta.storeShare || 0) * 1000) / 10,
          centerWeight: Math.round(Number(meta.centerWeight || 1) * 100) / 100,
          allocationIndex: Number(meta.allocationIndex || 0),
        }
      })
      .sort((a, b) => (b.recommendedBox || b.inputBox) - (a.recommendedBox || a.inputBox))
    const demandSignal = reservationSum >= 15000 ? '높음' : reservationSum >= 6000 ? '보통' : '낮음'
    const frontloadSignal = frontloadRatio >= 70 ? '초기 집중 높음' : frontloadRatio >= 45 ? '초기 집중 보통' : '후반 분산형'
    const similarAdequacySignal = similarAvgRate <= 0
      ? '유사상품 비교 데이터 부족'
      : similarAvgRate > 140
        ? '유사상품 과발주 가능성 확인 필요'
        : similarAvgRate >= 100
          ? '유사상품 정상 범위'
          : '유사상품 결품 가능성 확인 필요'
    const topCenters = centers.slice(0, 3).map((c) => c.centerName).join(', ')
    const centerSignal = topCenters
      ? `${topCenters}는 추천 분배량과 점포비중이 상대적으로 높아 초기 수요 확인 우선순위가 높습니다.`
      : '센터 분배 데이터가 부족합니다.'

    return {
      itemCode: row.itemCode,
      itemName: row.itemName,
      categoryPath: [row.category, row.categoryMid, row.categorySub].filter(Boolean).join(' / '),
      goalIntroRate: Number(row.goalIntroRate || 0),
      recommendedEa: mlRecommendEa(row),
      recommendedBox: mlRecommendBox(row),
      inputEa: currentInputEa(row),
      inputBox: currentInputBox(row),
      lduEa: ldu,
      reservationSum,
      first4,
      frontloadRatio: Math.round(frontloadRatio * 10) / 10,
      similarAvgOrder,
      similarAvgRate: Math.round(similarAvgRate * 10) / 10,
      demandSignal,
      frontloadSignal,
      similarAdequacySignal,
      centerSignal,
      centers,
      similarProducts: detail.similarProducts || [],
    }
  }
  const buildMdActionText = (payload) => {
    const topCenters = (payload.centers || []).slice(0, 3).map((c) => c.centerName).filter(Boolean)
    const recommendedVsSimilar = payload.similarAvgOrder > 0
      ? Math.round((payload.recommendedEa / payload.similarAvgOrder) * 1000) / 10
      : 0
    const deltaBox = Number(payload.inputBox || 0) - Number(payload.recommendedBox || 0)
    const inputText = deltaBox === 0
      ? '입력값은 모델 추천량과 동일합니다.'
      : `입력값은 모델보다 ${Math.abs(deltaBox).toLocaleString()}박스 ${deltaBox > 0 ? '많습니다' : '적습니다'}.`
    const decision = payload.similarAvgRate <= 0
      ? '판단: 유사상품 근거가 적어 예약추세와 센터 배분을 중심으로 보세요.'
      : payload.similarAvgRate > 140
        ? '판단: 유사상품 대비 과발주 가능성이 있습니다. 확정 전 감량 여지를 확인하세요.'
        : payload.similarAvgRate < 100
          ? '판단: 유사상품 대비 결품 가능성이 있습니다. 예약 반응이 강하면 증량을 검토하세요.'
          : '판단: 유사상품 기준은 정상 범위입니다. 센터 과다/부족만 확인하면 됩니다.'
    const centerText = topCenters.length ? `${topCenters.join(', ')}` : '상위 센터'
    const similarText = recommendedVsSimilar ? `유사상품 평균 발주량의 ${recommendedVsSimilar}%` : '유사상품 비교 데이터가 부족한'
    return [
      decision,
      `예약: 누적 ${payload.reservationSum.toLocaleString()}EA, 초기 집중도 ${payload.frontloadRatio.toFixed(1)}%입니다.`,
      `비교: 운영 추천량은 ${payload.recommendedEa.toLocaleString()}EA로, ${similarText} 수준입니다.`,
      `입력: ${inputText} 총량 변경 후 센터 합계를 확인하세요.`,
      `센터: ${centerText}부터 과다/부족 표시를 확인하세요.`,
    ].join('\n')
  }
  const buildMdOneLineReview = (payload) => {
    const topCenters = (payload.centers || []).slice(0, 3).map((c) => c.centerName).filter(Boolean)
    const similarRatio = payload.similarAvgOrder > 0
      ? Math.round((payload.recommendedEa / payload.similarAvgOrder) * 1000) / 10
      : 0
    const demandText = payload.reservationSum >= 12000
      ? '예약 수요가 강한 편'
      : payload.reservationSum >= 5000
        ? '예약 수요는 보통 수준'
        : '예약 수요가 낮은 편'
    const frontText = payload.frontloadRatio >= 70
      ? '초반 주문 집중도가 높아'
      : payload.frontloadRatio >= 45
        ? '예약 흐름이 고르게 분산되어'
        : '후반 주문 비중도 확인해야 해서'
    const similarText = similarRatio
      ? `유사상품 평균 대비 ${similarRatio}% 수준입니다`
      : '유사상품 기준은 보조 참고로만 보는 편이 좋습니다'
    const centerText = topCenters.length
      ? `${topCenters.join(', ')} 순으로 센터 분배를 먼저 확인하세요`
      : '센터 분배 데이터를 함께 확인하세요'
    return `${demandText}이고 ${frontText}, 운영 추천량은 ${similarText}. 확정 전 ${centerText}.`
  }
  const renderAiReview = (text) => {
    const lines = String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return (
      <div className="ai-review-list">
        {lines.map((line) => {
          const [label, ...bodyParts] = line.split(':')
          const body = bodyParts.join(':').trim()
          return (
            <p key={line}>
              {body ? (
                <>
                  <strong>{label}</strong>
                  <span>{body}</span>
                </>
              ) : (
                <span>{line}</span>
              )}
            </p>
          )
        })}
      </div>
    )
  }
  const renderRecommendationEvidence = (row) => {
    const detail = data?.itemDetails?.[row.rowKey]
    if (!detail) return null
    const evidence = detail.recommendationEvidence || {}
    const reservation = detail.reservation4d || []
    const reservationSum = Number(evidence.reservationDecisionSum || reservation.reduce((acc, p) => acc + Number(p.qty || 0), 0))
    const first4 = Number(evidence.reservationInitial4Sum || 0)
    const similarAvgOrder = Number(evidence.similarAvgOrderQty || 0)
    const similarAvgBox = Math.round(similarAvgOrder / boxUnitEa(row))
    const similarAvgRate = Number(evidence.similarAvgAdequacyRate || 0)
    const frontloadRatio = Number(evidence.frontloadRatio || 0)
    const mdReasonPayload = buildMdReasonPayload(row, evidence)
    const oneLineReview = buildMdOneLineReview(mdReasonPayload)
    return (
      <article className="recommendation-evidence-card">
        <div className="evidence-head">
          <div>
            <h3>권장 발주량 검토 근거</h3>
          </div>
          <div className="evidence-actions">
            <span className="kpi ok">합성 예시</span>
            <span className="kpi diff">MD 검토용</span>
          </div>
        </div>
        <div className="gemini-inline-opinion">
          <strong>규칙 기반 검토 의견</strong>
          <span>{oneLineReview}</span>
        </div>
        <div className="evidence-metrics">
          <div>
            <small>예약 수요 규모</small>
            <strong>{reservationSum.toLocaleString()}EA</strong>
            <span>출시 전 들어온 총 예약주문</span>
          </div>
          <div>
            <small>초반 몰림 정도</small>
            <strong>{first4.toLocaleString()}EA</strong>
            <span>초기 비중 {frontloadRatio.toFixed(1)}%</span>
          </div>
          <div>
            <small>비슷한 상품 평균 발주</small>
            <strong>{similarAvgBox.toLocaleString()}박스</strong>
            <span>EA {similarAvgOrder.toLocaleString()} · 과거 유사 사례 기준</span>
          </div>
          <div>
            <small>비슷한 상품 발주 적정성</small>
            <strong>{similarAvgRate.toFixed(1)}%</strong>
            <span>1.0~1.4배면 정상 범위</span>
          </div>
        </div>
      </article>
    )
  }
  const renderSimilarHistory = (row, limit = 4) => {
    const similarRows = data?.itemDetails?.[row.rowKey]?.similarProducts || []
    return (
      <article className="similar-history-card similar-history-card-wide similar-history-compact">
        <div className="similar-card-head">
          <div>
            <h3>유사상품 과거 발주량</h3>
            <p>같은 분류와 예약주문 흐름이 가까운 과거 사례입니다.</p>
          </div>
        </div>
        {!similarRows.length ? (
          <p className="similar-empty">조회 가능한 과거 유사상품이 없습니다.</p>
        ) : (
          <div className="similar-history">
            {similarRows.slice(0, limit).map((p) => {
              const similarKey = `${row.rowKey}-${p.itemCode || p.itemName}-${p.releaseDate}`
              const similarOpen = Boolean(similarExpandedMap[similarKey])
              const similarTone = Number(p.adequacyRate || 0) > 140 ? 'high' : Number(p.adequacyRate || 0) < 100 ? 'low' : 'ok'
              const similarLabel = similarTone === 'high' ? '과발주 사례' : similarTone === 'low' ? '결품위험 사례' : '정상 사례'
              const similarLdu = Math.max(Number(p.boxUnitEa || p.lduEa || boxUnitEa(row)), 1)
              const similarBox = Math.round(Number(p.actualOrderQty || 0) / similarLdu)
              return (
                <div
                  className={`similar-row clickable ${similarOpen ? 'open' : ''}`}
                  key={similarKey}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSimilarExpandedMap((prev) => ({ ...prev, [similarKey]: !prev[similarKey] }))
                  }}
                  onKeyDown={(event) => {
                    if (!['Enter', ' '].includes(event.key)) return
                    event.preventDefault()
                    event.stopPropagation()
                    setSimilarExpandedMap((prev) => ({ ...prev, [similarKey]: !prev[similarKey] }))
                  }}
                >
                  <span className="similar-product-name">
                    <span className="similar-title-line">
                      <span className="similar-date">{p.releaseDate}</span>
                      <b>{p.itemName}</b>
                      <span className={`similar-case-pill ${similarTone}`}>{similarLabel}</span>
                    </span>
                    <small className="similar-meta-line">
                      <span>{p.categoryMid} / {p.categorySub}</span>
                      <span>예약추세 {Number(p.trendSimilarity || 0).toFixed(1)}%</span>
                    </small>
                  </span>
                  <strong className="similar-order-summary">
                    <span>{similarBox.toLocaleString()}박스</span>
                    <small>EA {Number(p.actualOrderQty || 0).toLocaleString()} · 초도/적정 {Number(p.adequacyRate || 0).toFixed(1)}%</small>
                  </strong>
                  {similarOpen && (
                    <div className={`similar-detail ${similarTone}`}>
                      <span>{similarLabel}</span>
                      <p>
                        같은 소분류와 예약주문 흐름이 비슷한 상품입니다. 이 상품의 초도/적정 비율이 {Number(p.adequacyRate || 0).toFixed(1)}%였으므로,
                        현재 상품의 발주량이 과하거나 부족하지 않은지 비교 기준으로 활용할 수 있습니다.
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </article>
    )
  }
  const renderProductInfoSummary = (row) => {
    const info = data?.itemDetails?.[row.rowKey]?.productInfo || {}
    const points = Array.isArray(info.descriptionPoints) ? info.descriptionPoints.filter(Boolean) : []
    const meta = [
      info.capacity ? `규격 ${info.capacity}` : '',
      Number(info.profitRate || 0) > 0 ? `마진 ${Number(info.profitRate || 0).toFixed(1)}%` : '',
      info.displayLocation ? `진열 ${info.displayLocation}` : '',
      info.orderStartDate ? `예약/발주 ${info.orderStartDate}` : '',
    ].filter(Boolean)
    if (!points.length && !meta.length && !info.eventNote) return null
    return (
      <div className="drawer-product-info">
        <div className="drawer-section-title">상품 정보서 요약</div>
        {points.length > 0 && (
          <ul>
            {points.slice(0, 3).map((point) => <li key={point}>{point}</li>)}
          </ul>
        )}
        {meta.length > 0 && (
          <div className="drawer-product-meta">
            {meta.map((m) => <span key={m}>{m}</span>)}
          </div>
        )}
        {info.eventNote && <p>{info.eventNote}</p>}
      </div>
    )
  }
  const renderProductBasicPanel = (row) => {
    const info = data?.itemDetails?.[row.rowKey]?.productInfo || {}
    const intro = predictedIntroInfo(row)
    const ldu = boxUnitEa(row)
    const recommendedBox = mlRecommendBox(row)
    const inputBox = currentInputBox(row)
    const inputEa = inputBox * ldu
    const orderAmount = inputEa * Number(row.price || 0)
    const categoryPath = [row.category, row.categoryMid, row.categorySub].filter(Boolean).join(' / ')
    const primaryFields = [
      { label: '상품코드', value: row.itemCode || '-' },
      { label: '분류', value: categoryPath || '-' },
      { label: '판매가', value: `₩${Number(row.price || 0).toLocaleString()}` },
      { label: '박스입수', value: `${ldu.toLocaleString()}EA/박스` },
      { label: '목표도입률', value: `${Number(row.goalIntroRate || 0).toFixed(1)}%` },
      { label: '예측(GNN)', value: intro ? `${intro.rate.toFixed(1)}%` : '-' },
      { label: '권장 발주량', value: `${recommendedBox.toLocaleString()}박스` },
      { label: '현재 입력', value: `${inputBox.toLocaleString()}박스` },
    ]
    return (
      <section className="product-basic-panel">
        <div className="product-basic-title">
          <div>
            <strong>상품 기본 정보</strong>
            <span>정보서와 발주 입력 기준을 한 번에 확인합니다.</span>
          </div>
          <span className={`basic-status ${outflowBand(currentOutflowRate(row)) === 'over' ? 'high' : outflowBand(currentOutflowRate(row)) === 'shortage' ? 'low' : 'ok'}`}>
            {outflowBand(currentOutflowRate(row)) === 'over' ? '과발주 점검' : outflowBand(currentOutflowRate(row)) === 'shortage' ? '결품위험 점검' : '정상 범위'}
          </span>
        </div>
        <div className="product-basic-grid">
          {primaryFields.map((field) => (
            <div key={field.label}>
              <small>{field.label}</small>
              <strong>{field.value}</strong>
            </div>
          ))}
        </div>
        <div className="product-basic-foot">
          <span>EA 환산 {inputEa.toLocaleString()}EA</span>
          <span>예상 발주금액 ₩{orderAmount.toLocaleString()}</span>
          <span>조정 사유 {decisionNoteMap[row.rowKey] || '모델 추천 그대로'}</span>
        </div>
        {info.eventNote && <p className="product-basic-note">{info.eventNote}</p>}
      </section>
    )
  }
  const renderInlineGnnNetwork = (row) => {
    const detail = data?.itemDetails?.[row.rowKey] || {}
    const forward = detail.forwardPrediction || {}
    const forwardCentersRaw = Array.isArray(forward.centers) ? forward.centers : []
    const baseCenters = detail.centerDistribution || []
    const forwardByName = new Map(forwardCentersRaw.map((center) => [center.centerName, center]))
    const forwardCenters = (baseCenters.length ? baseCenters : forwardCentersRaw)
      .map((center) => ({
        ...center,
        ...(forwardByName.get(center.centerName) || {}),
        recommendedQty: Number(forwardByName.get(center.centerName)?.recommendedQty || 0),
        recommendedBox: Number(forwardByName.get(center.centerName)?.recommendedBox || 0),
        predictedStores: Number(forwardByName.get(center.centerName)?.predictedStores || 0),
        reservationQty: Number(forwardByName.get(center.centerName)?.reservationQty || 0),
      }))
    if (forwardCenters.length) {
      const maxQty = Math.max(...forwardCenters.map((center) => Number(center.recommendedQty || 0)), 1)
      const centerRows = [...forwardCenters].sort((a, b) => Number(b.recommendedQty || 0) - Number(a.recommendedQty || 0))
      const summaryRecommended = Number(forward.recommendedQty || centerRows.reduce((acc, c) => acc + Number(c.recommendedQty || 0), 0))
      const summaryReservation = Number(forward.reservationQty || centerRows.reduce((acc, c) => acc + Number(c.reservationQty || 0), 0))
      const summaryStores = Number(forward.predictedStores || centerRows.reduce((acc, c) => acc + Number(c.predictedStores || 0), 0))
      const ldu = boxUnitEa(row)
      const summaryBox = Math.round(summaryRecommended / ldu)
      const topCenters = centerRows.slice(0, 3)
      const topQty = topCenters.reduce((acc, center) => acc + Number(center.recommendedQty || 0), 0)
      const topBox = topCenters.reduce((acc, center) => acc + Number(center.recommendedBox || 0), 0)
      const topShare = summaryRecommended > 0 ? Math.round((topQty / summaryRecommended) * 100) : 0
      const topCenter = centerRows[0]
      return (
        <section className="inline-forward-gnn">
          <div className="forward-kpi-row">
            <article>
              <small>예약 수요</small>
              <strong>{summaryReservation.toLocaleString()}EA</strong>
            </article>
            <article>
              <small>예측 초도</small>
              <strong>{summaryRecommended.toLocaleString()}EA</strong>
              <span>{Math.round(summaryRecommended / ldu).toLocaleString()}박스</span>
            </article>
            <article>
              <small>예측 참여점포</small>
              <strong>{summaryStores.toLocaleString()}점포</strong>
            </article>
          </div>
          <div className="forward-network-grid">
            <div className="forward-demand-hub" aria-label="센터별 예약주문 예측 요약">
              <div className="forward-network-head">
                <strong>센터별 예약주문 예측</strong>
                <span>추천 초도 수량이 어느 센터에 집중되는지 순위와 비중으로 확인합니다.</span>
              </div>
              <div className="forward-hub-main">
                <div>
                  <span>최대 배분 센터</span>
                  <strong>{topCenter?.centerName || '-'}</strong>
                  <small>{Number(topCenter?.recommendedBox || 0).toLocaleString()}박스 · {Number(topCenter?.predictedStores || 0).toLocaleString()}점포</small>
                </div>
                <div className="forward-hub-total">
                  <b>{summaryBox.toLocaleString()}</b>
                  <span>총 추천 박스</span>
                </div>
              </div>
              <div className="forward-hub-summary">
                <article>
                  <small>상위 3센터 비중</small>
                  <strong>{topShare}%</strong>
                  <span>{topBox.toLocaleString()}박스</span>
                </article>
                <article>
                  <small>분배 센터</small>
                  <strong>{centerRows.length}개</strong>
                  <span>전체 센터 기준</span>
                </article>
              </div>
              <div className="forward-top-centers">
                {topCenters.map((center, idx) => {
                  const qty = Number(center.recommendedQty || 0)
                  const boxQty = Number(center.recommendedBox || 0)
                  const predictedStores = Number(center.predictedStores || 0)
                  const width = Math.max(qty > 0 ? 5 : 0, Math.min(100, (qty / maxQty) * 100))
                  return (
                    <div
                      className="forward-top-center"
                      key={`${row.rowKey}-top-network-${center.centerName}`}
                      onMouseEnter={(event) => showChartTooltip(event, [
                        `${idx + 1}순위 · ${center.centerName}`,
                        `${boxQty.toLocaleString()}박스`,
                        `${qty.toLocaleString()}EA · 예측 점포 ${predictedStores.toLocaleString()}점포`,
                      ])}
                      onMouseMove={moveChartTooltip}
                      onMouseLeave={() => setChartTooltip(null)}
                    >
                      <span>{idx + 1}</span>
                      <strong>
                        {center.centerName}
                        <small>예측 점포 {predictedStores.toLocaleString()}점포</small>
                      </strong>
                      <i><b style={{ width: `${width}%` }} /></i>
                      <em>{boxQty.toLocaleString()}박스</em>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="forward-center-list">
              {centerRows.slice(0, 15).map((center) => {
                const qty = Number(center.recommendedQty || 0)
                const width = Math.max(qty > 0 ? 4 : 0, Math.min(100, (qty / maxQty) * 100))
                return (
                  <div className="forward-center-row" key={`${row.rowKey}-forward-${center.centerName}`}>
                    <span>{center.centerName}</span>
                    <i><b style={{ width: `${width}%` }} /></i>
                    <strong>{Number(center.recommendedBox || 0).toLocaleString()}박스</strong>
                    <small>{qty.toLocaleString()}EA · 예측 점포 {Number(center.predictedStores || 0).toLocaleString()}점포</small>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )
    }
    const item = gnnItemByCode.get(String(row.itemCode || ''))
    const intro = predictedIntroInfo(row)
    if (!item) {
      return (
        <section className="inline-model-empty">
          <strong>GNN 직접 예측 데이터 없음</strong>
          <p>
            동일 분류 기반 예측 도입률은 {intro ? `${intro.rate.toFixed(1)}%` : '확인되지 않음'}입니다.
            직접 상품 네트워크가 없는 경우 예약추세와 유사상품 사례를 우선 확인하세요.
          </p>
        </section>
      )
    }
    const centers = [...(item.centers || [])]
      .sort((a, b) => Number(b.predictedStores || 0) - Number(a.predictedStores || 0))
      .slice(0, 10)
    const maxStores = Math.max(...centers.map((center) => Number(center.predictedStores || center.actualStores || 0)), 1)
    return (
      <section className="inline-network-panel">
        <div className="inline-network-kpis">
          <article>
            <small>예약 점포</small>
            <strong>{Number(item.summary?.reservationStores || 0).toLocaleString()}</strong>
          </article>
          <article>
            <small>예측 참여</small>
            <strong>{Number(item.summary?.predictedStores || 0).toLocaleString()}</strong>
          </article>
          <article>
            <small>실제 참여</small>
            <strong>{Number(item.summary?.actualStores || 0).toLocaleString()}</strong>
          </article>
          <article className={Number(item.summary?.predictionRatio || 0) >= 1 ? 'high' : 'low'}>
            <small>예측/실제</small>
            <strong>{Math.round(Number(item.summary?.predictionRatio || 0) * 100)}%</strong>
          </article>
        </div>
        <div className="inline-network-list">
          {centers.map((center) => {
            const predicted = Number(center.predictedStores || 0)
            const actual = Number(center.actualStores || 0)
            const predictedWidth = Math.max(predicted > 0 ? 3 : 0, Math.min(100, (predicted / maxStores) * 100))
            const actualWidth = Math.max(actual > 0 ? 3 : 0, Math.min(100, (actual / maxStores) * 100))
            return (
              <div className="inline-network-row" key={`${row.rowKey}-gnn-${center.centerCode || center.centerName}`}>
                <span>{center.centerName}</span>
                <i>
                  <b className="predicted" style={{ width: `${predictedWidth}%` }} />
                  <b className="actual" style={{ width: `${actualWidth}%` }} />
                </i>
                <strong>{predicted.toLocaleString()} / {actual.toLocaleString()}점포</strong>
              </div>
            )
          })}
        </div>
        <p className="inline-network-note">초록은 예측 참여, 파랑은 실제 참여입니다. 예측보다 실제가 낮은 센터는 도입 점포 확대 여부를 확인하세요.</p>
      </section>
    )
  }
  const renderInlineLifecyclePanel = (row) => {
    const detail = data?.itemDetails?.[row.rowKey] || {}
    const forward = detail.forwardPrediction || {}
    const forwardCenters = Array.isArray(forward.centers) ? forward.centers : []
    if (forwardCenters.length || Number(forward.lifecycleDemandUpper || 0) > 0) {
      const ldu = boxUnitEa(row)
      const reservation = Number(forward.reservationQty || 0)
      const recommended = Number(forward.recommendedQty || row.mlRecommendQty || 0)
      const upper = Number(forward.lifecycleDemandUpper || forwardCenters.reduce((acc, c) => acc + Number(c.lifecycleDemandUpper || 0), 0))
      const centerRows = [...forwardCenters].sort((a, b) => Number(b.lifecycleDemandUpper || 0) - Number(a.lifecycleDemandUpper || 0)).slice(0, 8)
      const lifecycleBase = Math.max(upper, recommended, reservation, 1)
      const weeklyShape = [0.38, 0.27, 0.2, 0.15]
      const weeklySales = weeklyShape.map((share, idx) => ({
        date: `${idx + 1}주`,
        qty: Math.round(lifecycleBase * share),
      }))
      const weeklyCumulative = weeklySales.reduce((acc, point, idx) => {
        const prev = idx > 0 ? acc[idx - 1].qty : 0
        acc.push({ date: point.date, qty: prev + Number(point.qty || 0) })
        return acc
      }, [])
      const width = 560
      const height = 245
      const pad = 34
      const bounds = { min: 0, max: Math.max(...weeklyCumulative.map((p) => p.qty), ...weeklySales.map((p) => p.qty), 1) }
      return (
        <section className="inline-lifecycle-panel forward-lifecycle-panel">
          <div className="inline-lifecycle-kpis">
            <article>
              <small>예약 수요</small>
              <strong>{reservation.toLocaleString()}EA</strong>
              <span>{Math.round(reservation / ldu).toLocaleString()}박스</span>
            </article>
            <article>
              <small>운영 추천 초도</small>
              <strong>{recommended.toLocaleString()}EA</strong>
              <span>{Math.round(recommended / ldu).toLocaleString()}박스</span>
            </article>
            <article>
              <small>생애수요 상한</small>
              <strong>{upper.toLocaleString()}EA</strong>
              <span>{Math.round(upper / ldu).toLocaleString()}박스</span>
            </article>
            <article className={upper > recommended ? 'ok' : 'low'}>
              <small>상한 대비 초도</small>
              <strong>{upper > 0 ? `${((recommended / upper) * 100).toFixed(1)}%` : '-'}</strong>
              <span>초도 과부족 점검</span>
            </article>
          </div>
          <div className="lifecycle-explain-card">
            <strong>상품·센터별 수요 예측 해석</strong>
            <p>
              이 영역은 금일 의사결정 대상 상품의 예약 수요와 센터별 예측 판매 흐름을 연결해,
              출시 후 4주 동안 어느 시점에 수요가 몰릴지 보여주는 보조 근거입니다.
              1~2주차 예측 판매가 높으면 초기 배분을 보수적으로 줄이기보다 센터별 결품 위험을 함께 확인합니다.
            </p>
          </div>
          <div className="forward-lifecycle-chart-head">
            <strong>주차별 예측 판매량</strong>
            <span>막대: 주차별 예측 · 점선: 누적 예측</span>
          </div>
          <svg className="inline-lifecycle-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="주차별 예측 판매 흐름">
            {chartGrid(width, height, pad, `forward-life-${row.rowKey}`)}
            <path d={buildAreaPath(weeklyCumulative, width, height, pad, bounds)} fill="#dbeafe" opacity="0.6" />
            <path d={buildLinePath(weeklyCumulative, width, height, pad, bounds)} fill="none" stroke="#2563eb" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 5" />
            {weeklySales.map((p, idx) => {
              const { x, y } = pointXY(p, idx, weeklySales, width, height, pad, bounds)
              const barWidth = 34
              const barHeight = Math.max(4, height - pad - y)
              return (
                <g key={`forward-life-${p.date}`}>
                  <rect x={x - barWidth / 2} y={y} width={barWidth} height={barHeight} rx="8" fill="#0c7a43" opacity="0.82" />
                  <text x={x} y={Math.max(18, y - 10)} textAnchor="middle" fontSize="12" fontWeight="900" fill="#0f5132">
                    {Number(p.qty || 0).toLocaleString()}
                  </text>
                  <text x={x} y={height - 8} textAnchor="middle" fontSize="11" fontWeight="850" fill="#64748b">
                    {p.date}
                  </text>
                  <circle
                    className="chart-hover-target"
                    cx={x}
                    cy={y}
                    r="14"
                    fill="transparent"
                    onMouseEnter={(event) => showChartTooltip(event, [p.date, `예측 판매 ${Number(p.qty || 0).toLocaleString()}EA`, `${Math.round(Number(p.qty || 0) / ldu).toLocaleString()}박스`])}
                    onMouseMove={moveChartTooltip}
                    onMouseLeave={() => setChartTooltip(null)}
                  />
                </g>
              )
            })}
            {weeklyCumulative.map((p, idx) => {
              const { x, y } = pointXY(p, idx, weeklyCumulative, width, height, pad, bounds)
              const isLast = idx === weeklyCumulative.length - 1
              return (
                <g key={`forward-life-cum-${p.date}`}>
                  <circle cx={x} cy={y} r="4.5" fill="#2563eb" stroke="#fff" strokeWidth="2.2" />
                  {isLast && (
                    <text x={x - 4} y={Math.max(18, y - 12)} textAnchor="end" fontSize="12" fontWeight="950" fill="#1d4ed8">
                      누적 {Number(p.qty || 0).toLocaleString()}
                    </text>
                  )}
                  <circle
                    className="chart-hover-target"
                    cx={x}
                    cy={y}
                    r="14"
                    fill="transparent"
                    onMouseEnter={(event) => showChartTooltip(event, [p.date, `누적 예측 ${Number(p.qty || 0).toLocaleString()}EA`, `${Math.round(Number(p.qty || 0) / ldu).toLocaleString()}박스`])}
                    onMouseMove={moveChartTooltip}
                    onMouseLeave={() => setChartTooltip(null)}
                  />
                </g>
              )
            })}
          </svg>
          <div className="forward-lifecycle-centers">
            {centerRows.map((center) => (
              <span key={`${row.rowKey}-life-center-${center.centerName}`}>
                {center.centerName} <b>{Number(center.lifecycleDemandUpper || 0).toLocaleString()}EA</b>
              </span>
            ))}
          </div>
        </section>
      )
    }
    const item = lifecycleItemByCode.get(String(row.itemCode || ''))
    if (!item) {
      return (
        <section className="inline-model-empty">
          <strong>제품 생애주기 직접 예측 데이터 없음</strong>
          <p>현재 상품 코드와 매칭되는 생애주기 예측 결과가 없습니다. 예약 정보와 유사상품 발주 이력을 우선 활용하세요.</p>
        </section>
      )
    }
    const weeks = item.weekly || []
    const predicted = weeks.map((week) => ({ date: `${week.weekIndex}주`, qty: Number(week.predicted || 0) }))
    const actual = weeks.map((week) => ({ date: `${week.weekIndex}주`, qty: Number(week.actual || 0) }))
    const bounds = {
      min: 0,
      max: Math.max(...predicted.map((p) => p.qty), ...actual.map((p) => p.qty), 1),
    }
    const width = 560
    const height = 210
    const pad = 34
    return (
      <section className="inline-lifecycle-panel">
        <div className="inline-lifecycle-kpis">
          <article>
            <small>D-5 예약 신호</small>
            <strong>{Number(item.d5QtySum || 0).toLocaleString()}EA</strong>
          </article>
          <article>
            <small>예측 총 판매</small>
            <strong>{Math.round(Number(item.predictedTotal || 0)).toLocaleString()}EA</strong>
          </article>
          <article>
            <small>검증 실제 판매</small>
            <strong>{Math.round(Number(item.actualTotal || 0)).toLocaleString()}EA</strong>
          </article>
          <article className={Number(item.predictionRatio || 0) >= 1 ? 'high' : 'low'}>
            <small>예측/실제</small>
            <strong>{Math.round(Number(item.predictionRatio || 0) * 100)}%</strong>
          </article>
        </div>
        <div className="lifecycle-explain-card">
          <strong>상품·센터별 생애주기 비교</strong>
          <p>
            예측 판매와 실제 판매 흐름을 같은 주차 기준으로 비교합니다. 실제 판매가 예측보다 빠르게 올라오면 추가 발주나 센터 보강을,
            느리면 다음 유사상품 발주 시 초도 수량을 낮추는 근거로 활용할 수 있습니다.
          </p>
        </div>
        <svg className="inline-lifecycle-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="제품 생애주기 예측과 실제">
          {chartGrid(width, height, pad, `inline-life-${row.rowKey}`)}
          <path d={buildAreaPath(predicted, width, height, pad, bounds)} fill="#dbeafe" opacity="0.58" />
          <path d={buildLinePath(predicted, width, height, pad, bounds)} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={buildLinePath(actual, width, height, pad, bounds)} fill="none" stroke="#0c7a43" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 5" />
          {predicted.map((p, idx) => {
            const { x, y } = pointXY(p, idx, predicted, width, height, pad, bounds)
            return (
              <g key={`inline-life-p-${p.date}`}>
                <circle cx={x} cy={y} r="4" fill="#2563eb" stroke="#fff" strokeWidth="2" />
                <circle
                  className="chart-hover-target"
                  cx={x}
                  cy={y}
                  r="12"
                  fill="transparent"
                  onMouseEnter={(event) => showChartTooltip(event, [p.date, `예측 판매 ${Number(p.qty || 0).toLocaleString()}EA`])}
                  onMouseMove={moveChartTooltip}
                  onMouseLeave={() => setChartTooltip(null)}
                />
              </g>
            )
          })}
          {actual.map((p, idx) => {
            const { x, y } = pointXY(p, idx, actual, width, height, pad, bounds)
            return (
              <g key={`inline-life-a-${p.date}`}>
                <circle cx={x} cy={y} r="4" fill="#0c7a43" stroke="#fff" strokeWidth="2" />
                <circle
                  className="chart-hover-target"
                  cx={x}
                  cy={y}
                  r="12"
                  fill="transparent"
                  onMouseEnter={(event) => showChartTooltip(event, [p.date, `실제 판매 ${Number(p.qty || 0).toLocaleString()}EA`])}
                  onMouseMove={moveChartTooltip}
                  onMouseLeave={() => setChartTooltip(null)}
                />
                <text x={x} y={height - 8} textAnchor="middle" fontSize="10.5" fontWeight="750" fill="#64748b">
                  {p.date}
                </text>
              </g>
            )
          })}
        </svg>
        <div className="inline-lifecycle-legend">
          <span><i className="predicted" />예측 판매</span>
          <span><i className="actual" />실제 판매</span>
        </div>
      </section>
    )
  }
  const renderDrawerReservationTrend = (row) => {
    const detail = data?.itemDetails?.[row.rowKey] || {}
    const baseReservation = (detail.reservationPreRelease || detail.reservation4d || [])
      .map((p) => ({ date: p.date, qty: Number(p.qty || 0) }))
    if (!baseReservation.length) return null
    const baseCumulative = baseReservation.reduce((acc, p, idx) => {
      const prev = idx > 0 ? acc[idx - 1].qty : 0
      acc.push({ date: p.date, qty: prev + Number(p.qty || 0) })
      return acc
    }, [])
    const baseTotal = baseCumulative[baseCumulative.length - 1]?.qty || 0
    const forwardCenters = Array.isArray(detail.forwardPrediction?.centers) ? detail.forwardPrediction.centers : []
    const centerDistribution = Array.isArray(detail.centerDistribution) ? detail.centerDistribution : []
    const centerSource = forwardCenters.length
      ? forwardCenters
      : centerDistribution.map((center) => ({
        centerCode: center.centerCode,
        centerName: center.centerName,
        reservationQty: center.qty,
        recommendedBox: Math.round(Number(center.qty || 0) / Math.max(boxUnitEa(row), 1)),
      }))
    const centerDenominator = Math.max(
      centerSource.reduce((sum, center) => sum + Number(center.reservationQty || 0), 0),
      1,
    )
    const centerOptions = [
      { key: 'all', label: '전체', share: 1, reservationQty: baseTotal },
      ...centerSource.map((center) => {
        const reservationQty = Number(center.reservationQty || 0)
        return {
          key: String(center.centerCode || center.centerName),
          label: center.centerName,
          share: reservationQty / centerDenominator,
          reservationQty,
        }
      }),
    ]
    const selectedCenterKey = reservationCenterMap[row.rowKey] || 'all'
    const selectedCenter = centerOptions.find((option) => option.key === selectedCenterKey) || centerOptions[0]
    const reservation = selectedCenter.key === 'all'
      ? baseReservation
      : baseReservation.map((p) => ({ ...p, qty: Math.round(Number(p.qty || 0) * selectedCenter.share) }))
    const reservationCumulative = reservation.reduce((acc, p, idx) => {
      const prev = idx > 0 ? acc[idx - 1].qty : 0
      acc.push({ date: p.date, qty: prev + Number(p.qty || 0) })
      return acc
    }, [])
    const bounds = {
      min: 0,
      max: Math.max(
        ...reservation.map((p) => Number(p.qty || 0)),
        ...reservationCumulative.map((p) => Number(p.qty || 0)),
        1,
      ),
    }
    const width = 500
    const height = 220
    const pad = 34
    const dateRangeLabel = `${formatMd(reservation[0].date)} ~ ${formatMd(reservation[reservation.length - 1].date)}`
    const reservationTotal = reservationCumulative[reservationCumulative.length - 1]?.qty || 0
    const initial4Qty = reservation.slice(0, 4).reduce((sum, p) => sum + Number(p.qty || 0), 0)
    const frontloadRatio = reservationTotal > 0 ? (initial4Qty / reservationTotal) * 100 : 0
    const peakPoint = reservation.reduce((max, p) => (Number(p.qty || 0) > Number(max.qty || 0) ? p : max), reservation[0])
    const recommendedEa = Number(row.mlRecommendQty || 0)
    const recommendedBox = mlRecommendBox(row)
    return (
      <div className="drawer-trend-card">
        <div className="current-chart-head">
          <h3>예약주문 추세선</h3>
          <span>{dateRangeLabel}</span>
        </div>
        {centerOptions.length > 1 && (
          <div className="reservation-center-filter">
            <span>조회 기준</span>
            <div>
              {centerOptions.map((option) => (
                <button
                  type="button"
                  key={`${row.rowKey}-reservation-${option.key}`}
                  className={selectedCenter.key === option.key ? 'active' : ''}
                  onClick={(event) => {
                    event.stopPropagation()
                    setReservationCenterMap((prev) => ({ ...prev, [row.rowKey]: option.key }))
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="current-trend-panel drawer-trend-panel">
          <div className="current-trend-subhead">
            <strong>실선: 일자별 예약주문 · 점선: 누적 예약주문</strong>
            <span>{selectedCenter.key === 'all' ? '전체 기준' : `${selectedCenter.label} 추정 기준`}</span>
          </div>
          <svg className="trend-line current-overlay-trend drawer-overlay-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="예약주문 일자별 및 누적 추세">
            {chartGrid(width, height, pad, `drawer-${row.rowKey}`)}
            <path d={buildAreaPath(reservationCumulative, width, height, pad, bounds)} fill="#dbeafe" opacity="0.58" />
            <path d={buildLinePath(reservationCumulative, width, height, pad, bounds)} fill="none" stroke="#2563eb" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="7 6" />
            <path d={buildAreaPath(reservation, width, height, pad, bounds)} fill="#dcfce7" opacity="0.52" />
            <path d={buildLinePath(reservation, width, height, pad, bounds)} fill="none" stroke="#0c7a43" strokeWidth="3.8" strokeLinejoin="round" strokeLinecap="round" />
            {reservationCumulative.map((p, idx) => {
              const { x, y } = pointXY(p, idx, reservationCumulative, width, height, pad, bounds)
              const isLast = idx === reservationCumulative.length - 1
              return (
                <g key={`drawer-cum-${p.date}`}>
                  <circle cx={x} cy={y} r={isLast ? 5 : 3.5} fill="#2563eb" stroke="#f8fafc" strokeWidth="2.5" />
                  <circle
                    className="chart-hover-target"
                    cx={x}
                    cy={y}
                    r="12"
                    fill="transparent"
                    onMouseEnter={(event) => showChartTooltip(event, [p.date, `${selectedCenter.label} 누적 예약주문 ${Number(p.qty || 0).toLocaleString()}EA`])}
                    onMouseMove={moveChartTooltip}
                    onMouseLeave={() => setChartTooltip(null)}
                  />
                  {isLast && (
                    <text x={Math.max(58, x - 4)} y={Math.max(16, y - 12)} textAnchor="end" fontSize="10.5" fontWeight="850" fill="#1e3a8a" stroke="#f8fafc" strokeWidth="4" paintOrder="stroke">
                      누적 {Number(p.qty || 0).toLocaleString()}
                    </text>
                  )}
                </g>
              )
            })}
            {reservation.map((p, idx) => {
              const { x, y } = pointXY(p, idx, reservation, width, height, pad, bounds)
              const cumulativePoint = reservationCumulative[idx]
              const cumulativeY = cumulativePoint
                ? pointXY(cumulativePoint, idx, reservationCumulative, width, height, pad, bounds).y
                : -999
              const preferredY = y < 48 ? y + 26 : y - 14
              const collidesWithCumulative = Math.abs(preferredY - cumulativeY) < 24
              const labelY = collidesWithCumulative ? Math.min(y + 30, height - 36) : preferredY
              return (
                <g key={`drawer-day-${p.date}`}>
                  <circle cx={x} cy={y} r="5.2" fill="#0c7a43" stroke="#f8fafc" strokeWidth="3" />
                  <circle
                    className="chart-hover-target"
                    cx={x}
                    cy={y}
                    r="14"
                    fill="transparent"
                    onMouseEnter={(event) => showChartTooltip(event, [p.date, `${selectedCenter.label} 일자별 예약주문 ${Number(p.qty || 0).toLocaleString()}EA`])}
                    onMouseMove={moveChartTooltip}
                    onMouseLeave={() => setChartTooltip(null)}
                  />
                  <text x={x} y={labelY} textAnchor="middle" fontSize="10.5" fontWeight="850" fill="#14532d" stroke="#f8fafc" strokeWidth="4" paintOrder="stroke">
                    {Number(p.qty || 0).toLocaleString()}
                  </text>
                  <text x={x} y={height - 8} textAnchor="middle" fontSize="10.5" fontWeight="750" fill="#64748b">
                    {formatMd(p.date)}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
        <div className="reservation-insight-cards">
          <article>
            <small>{selectedCenter.key === 'all' ? '누적 예약' : '센터 추정 예약'}</small>
            <strong>{reservationTotal.toLocaleString()}EA</strong>
            <span>{selectedCenter.key === 'all' ? '출시 전 확인된 총 수요' : `${selectedCenter.label} 배분 비중 기준`}</span>
          </article>
          <article>
            <small>초기 4일 집중</small>
            <strong>{initial4Qty.toLocaleString()}EA</strong>
            <span>초기 비중 {frontloadRatio.toFixed(1)}%</span>
          </article>
          <article>
            <small>피크 일자</small>
            <strong>{formatMd(peakPoint.date)}</strong>
            <span>{Number(peakPoint.qty || 0).toLocaleString()}EA 예약</span>
          </article>
          <article>
            <small>운영 추천</small>
            <strong>{recommendedBox.toLocaleString()}박스</strong>
            <span>EA {recommendedEa.toLocaleString()}</span>
          </article>
        </div>
        {selectedCenter.key !== 'all' && (
          <p className="reservation-context-note">
            센터별 예약추세는 전체 예약 곡선을 센터별 예약/배분 비중으로 환산한 추정값입니다. 실제 확정 전에는 우측 센터별 분배 수량과 함께 확인하세요.
          </p>
        )}
      </div>
    )
  }
  const renderDrawerAiReview = (row) => {
    const detail = data?.itemDetails?.[row.rowKey] || {}
    const evidence = detail.recommendationEvidence || {}
    const payload = buildMdReasonPayload(row, evidence)
    return (
      <article className="drawer-ai-card">
        <div className="drawer-section-head">
          <div className="drawer-section-title">데모 발주 검토 의견</div>
          <small>발주 확정 전 확인 문장</small>
        </div>
        {renderAiReview(buildMdActionText(payload))}
      </article>
    )
  }
  const showChartTooltip = (event, lines) => {
    setChartTooltip({
      x: event.clientX,
      y: event.clientY,
      lines: Array.isArray(lines) ? lines : [lines],
    })
  }
  const moveChartTooltip = (event) => {
    setChartTooltip((prev) => (prev ? { ...prev, x: event.clientX, y: event.clientY } : prev))
  }
  const selectedCalcRow = baseRows.find((r) => r.rowKey === selectedItemCode)
  const selectedTodayRow = activeTab === '금주+MD'
    ? filteredRows.find((r) => r.rowKey === selectedItemCode)
    : null
  const onlyDigits = (value) => String(value || '').replace(/[^\d]/g, '')
  const calcBoxNum = Math.max(Number(calcBox || 0), 0)
  const calcLduNum = Math.max(Number(calcLdu || 1), 1)
  const calcRecommendedBoxNum = Math.max(Number(calcRecommendedBox || 0), 0)
  const calcTargetEaNum = Math.max(Number(calcTargetEa || 0), 0)
  const calcEa = toEaFromBox(calcBoxNum, calcLduNum)
  const calcRecommendedEa = toEaFromBox(calcRecommendedBoxNum, calcLduNum)
  const calcDiffBox = calcBoxNum - calcRecommendedBoxNum
  const calcDiffEa = calcEa - calcRecommendedEa
  const calcRecommendRatio = calcRecommendedBoxNum > 0 ? (calcBoxNum / calcRecommendedBoxNum) * 100 : 0
  const calcTargetRatio = calcTargetEaNum > 0 ? (calcEa / calcTargetEaNum) * 100 : 0
  const calcTargetStatus =
    calcTargetRatio === 0
      ? '계산 대기'
      : calcTargetRatio < 100
        ? '결품위험'
        : calcTargetRatio <= 140
          ? '정상범위'
          : '과발주'
  const calcTargetTone =
    calcTargetRatio === 0 ? 'neutral' : calcTargetRatio < 100 ? 'low' : calcTargetRatio <= 140 ? 'ok' : 'high'
  const loadSelectedToCalculator = () => {
    if (!selectedCalcRow) return
    const ldu = boxUnitEa(selectedCalcRow)
    const recommendedBox = mlRecommendBox(selectedCalcRow)
    const inputBox = currentInputBox(selectedCalcRow) || recommendedBox
    const targetEa = Math.max(mlRecommendEa(selectedCalcRow), 0)
    setCalcLdu(String(ldu))
    setCalcBox(String(inputBox))
    setCalcRecommendedBox(String(recommendedBox))
    setCalcTargetEa(String(targetEa))
    setCalculatorOpen(true)
  }

  const renderMdAvatar = () => (
    <div className="today-avatar" aria-label={`${mdDisplayName} 프로필`}>
      <svg className="md-face" viewBox="0 0 80 80" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="avatarSkin" x1="20" x2="60" y1="18" y2="66" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffe2bd" />
            <stop offset="1" stopColor="#f5b982" />
          </linearGradient>
          <linearGradient id="avatarShirt" x1="26" x2="56" y1="58" y2="78" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0f766e" />
            <stop offset="1" stopColor="#064e3b" />
          </linearGradient>
        </defs>
        <g className="md-face-bob">
          <path className="md-neck" d="M33 56h14l3 12H30l3-12Z" />
          <path className="md-shirt" d="M18 78c2-12 10-18 22-18s20 6 22 18H18Z" />
          <circle className="md-head" cx="40" cy="38" r="22" />
          <path className="md-hair" d="M20 37c1-15 10-25 23-25 12 0 21 8 22 22-7-7-16-7-27-4-7 2-12 4-18 7Z" />
          <path className="md-hair-front" d="M26 30c7-9 22-12 32-1-12-2-20 2-31 8-2-2-2-4-1-7Z" />
          <g className="md-eyes">
            <path d="M31 39h6" />
            <path d="M45 39h6" />
          </g>
          <path className="md-nose" d="M40 41l-2 7h4" />
          <path className="md-mouth" d="M34 52c3 3 9 3 12 0" />
          <circle className="md-cheek" cx="28" cy="47" r="3" />
          <circle className="md-cheek" cx="52" cy="47" r="3" />
        </g>
      </svg>
    </div>
  )

  const handleLogin = (event) => {
    event.preventDefault()
    if (loginPassword.trim() !== LOGIN_ACCESS_CODE) {
      setLoginError('접속 코드를 다시 확인해 주세요. 데모 접속 코드는 711입니다.')
      return
    }
    const nextProfile = parseLoginIdentity(loginId)
    setMdProfile(nextProfile)
    window.sessionStorage.setItem('sevenMdLoggedIn', '1')
    window.sessionStorage.setItem('sevenMdLoginInput', loginId.trim() || '담당자 MD')
    setLoginError('')
    setIsLoggedIn(true)
  }

  const renderDashboardHero = () => {
    const remaining = Math.max(weeklyQueue.total - confirmedCount, 0)
    const currentDateLabel = FIXED_DECISION_DATE.replace(/-/g, '.')
    const hero = {
      '금주+MD': {
        eyebrow: '오늘 확인할 작업',
        headline: weeklyQueue.total === 0 ? '오늘 확정 대기 상품 없음' : `초도발주 ${remaining}건 남음`,
        profileMeta: '과자 담당 · 출시 5일 전 의사결정',
        cardTitle: weeklyQueue.total === 0 ? '오늘은 작업할 신상품이 없습니다' : '오늘 발주 확정이 필요합니다',
        cardText: weeklyQueue.total === 0
          ? '현재 날짜에는 출시 5일 전 의사결정 대상 상품이 없습니다. 과거 신상품 조회에서 참고 사례를 확인할 수 있습니다.'
          : `센터 입고와 점포 전개 일정을 맞추려면 현재 날짜 ${currentDateLabel}에 ${weeklyQueue.total}개 상품의 초도 발주량을 확정해야 합니다.`,
        statusTitle: '발주 확정 현황',
        statusValue: `${confirmedCount}/${weeklyQueue.total} 완료`,
        statusText: weeklyQueue.total === 0 ? '저장할 센터 배분 없음' : `${remaining}건 남음 · 확정 후 센터별 배분 저장 가능`,
        action: (
          <button
            type="button"
            className="today-download"
            onClick={exportCenterAllocations}
            disabled={!filteredRows.length}
          >
            엑셀 다운로드
          </button>
        ),
      },
      과거: {
        eyebrow: '과거 성과 분석',
        headline: `${filteredPastRows.length.toLocaleString()}개 과거 과자 신상품 조회`,
        profileMeta: '과자 담당 · 성과 분석',
        cardTitle: '초도 발주와 출시 후 성과를 함께 봅니다',
        cardText: '초도 물량, 센터 출고, 점포 판매, 목표/예측(GNN) 도입률을 한 화면에서 비교합니다.',
        statusTitle: '현재 필터 결과',
        statusValue: `${filteredPastRows.filter((r) => Number(r.salesRate || 0) >= 100 && Number(r.salesRate || 0) <= 140).length.toLocaleString()}개 정상`,
        statusText: `과발주 ${filteredPastRows.filter((r) => Number(r.salesRate || 0) > 140).length.toLocaleString()}개 · 결품위험 ${filteredPastRows.filter((r) => Number(r.salesRate || 0) < 100).length.toLocaleString()}개`,
      },
      GNN: {
        eyebrow: '보조 모델 점검',
        headline: `GNN 수요 네트워크 ${Number(gnnData?.totals?.items || 0).toLocaleString()}개 상품`,
        profileMeta: '과자 담당 · 점포 참여 확장 검토',
        cardTitle: '상품에서 센터와 점포군으로 퍼지는 수요를 봅니다',
        cardText: '예약 점포가 실제 본발주 참여로 확장되는 흐름을 지도와 네트워크로 확인해 도입률과 센터별 수요 강도를 판단합니다.',
        statusTitle: '네트워크 데이터',
        statusValue: `${Number(gnnData?.totals?.centers || 0).toLocaleString()}개 센터`,
        statusText: '선 굵기와 노드 크기로 예측 참여점포와 실제 참여점포를 비교',
      },
      LIFECYCLE: {
        eyebrow: '보조 모델 점검',
        headline: `제품 생애주기 ${Number(lifecycleData?.summary?.itemCount || 0).toLocaleString()}개 상품`,
        profileMeta: '과자 담당 · 출시 후 판매 흐름 검토',
        cardTitle: '출시 후 주차별 수요 흐름을 예측합니다',
        cardText: '예약 신호와 과거 판매 흐름을 바탕으로 주차별 판매 곡선을 확인해 초도 이후 운영 대응 방향을 잡습니다.',
        statusTitle: '생애주기 데이터',
        statusValue: `${Number(lifecycleData?.summary?.centerCount || 0).toLocaleString()}개 센터`,
        statusText: '예측/실제 누적 흐름과 센터별 판매 차이 확인',
      },
    }[activeTab]

    return (
      <section className={`dashboard-hero ${weeklyQueue.total === 0 && activeTab === '금주+MD' ? 'empty' : ''}`}>
        <div className="today-profile">
          {renderMdAvatar()}
          <div>
            <div className="profile-eyebrow-row">
              <span>좋은 오후입니다</span>
              <b>현재 날짜 {currentDateLabel}</b>
            </div>
            <strong>{mdDisplayName}</strong>
            <p>{hero.profileMeta}</p>
          </div>
        </div>
        <div className="today-brief">
          <div className="today-brief-head">
            <span className="today-brief-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M7 3v3M17 3v3M4.5 9.5h15M6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-10A2.5 2.5 0 0 1 6.5 5Z" />
              </svg>
            </span>
            <div>
              <span>{hero.eyebrow}</span>
              <strong>{hero.headline}</strong>
            </div>
          </div>
          <div className="today-decision-grid">
            <article className="today-decision-card">
              <span className="task-icon order">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" />
                </svg>
              </span>
              <div>
                <strong>{hero.cardTitle}</strong>
                <p>{hero.cardText}</p>
              </div>
            </article>
            <article className="today-status-card">
              <div className="today-status-main">
                <span>{hero.statusTitle}</span>
                <strong>{hero.statusValue}</strong>
                <p>{hero.statusText}</p>
              </div>
              {hero.action}
            </article>
          </div>
        </div>
      </section>
    )
  }

  if (!isLoggedIn) {
    return (
      <div className="login-page">
        <section className="login-card">
          <div className="login-brand">
            <div className="logo">7</div>
            <div>
              <p>세븐일레븐</p>
              <h1>MD 신상품 초도발주 데모</h1>
            </div>
          </div>
          <div className="login-copy">
            {renderMdAvatar()}
            <div>
              <span>MD 업무 포털</span>
              <strong>신상품 초도발주 의사결정을 시작합니다.</strong>
              <p>합성 데이터로 구성한 포트폴리오 데모입니다. 데모 접속 코드 711을 입력해 예약 흐름, 추천량 검토와 센터 배분을 체험하세요. 실제 발주는 전송되지 않습니다.</p>
            </div>
          </div>
          <form className="login-form" onSubmit={handleLogin}>
            <label>
              <span>MD 이름</span>
              <input
                value={loginId}
                onChange={(event) => {
                  setLoginId(event.target.value)
                  setLoginError('')
                }}
                placeholder="예: 홍길동"
              />
            </label>
            <label>
              <span>접속 코드</span>
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => {
                  setLoginPassword(event.target.value)
                  setLoginError('')
                }}
                placeholder="711"
              />
            </label>
            <button type="submit">대시보드 들어가기</button>
            {loginError && <p className="login-error">{loginError}</p>}
          </form>
        </section>
      </div>
    )
  }

  if (!data) return <div className="page"><main className="container">데이터 로딩 중...</main></div>

  return (
    <div className="page">
      <div className="portfolio-demo-banner" role="note"><strong>PORTFOLIO DEMO</strong><span>모든 상품·센터·예측값은 합성 예시입니다. 실제 발주는 전송되지 않습니다.</span><a href="https://github.com/daniel5781/7Eleven_MD_Dashboard" target="_blank" rel="noreferrer">프로젝트 보기 ↗</a></div>
      {chartTooltip && (
        <div
          className="chart-tooltip"
          style={{ left: chartTooltip.x, top: chartTooltip.y }}
        >
          {chartTooltip.lines.map((line) => <span key={line}>{line}</span>)}
        </div>
      )}
      {!selectedItemCode && (
        <button
          type="button"
          className={`mini-calculator-toggle ${calculatorOpen ? 'active' : ''}`}
          onClick={() => setCalculatorOpen((prev) => !prev)}
        >
          계산기
        </button>
      )}
      {!selectedItemCode && calculatorOpen && (
        <section className="mini-calculator-panel" aria-label="미니 계산기">
          <div className="mini-calculator-head">
            <div>
              <strong>미니 계산기</strong>
              <span>박스·EA·권장 대비 빠른 계산</span>
            </div>
            <button type="button" onClick={() => setCalculatorOpen(false)}>닫기</button>
          </div>
          <div className="mini-calculator-grid">
            <label className="calc-field">
              <span>입력 박스</span>
              <input
                type="text"
                inputMode="numeric"
                value={calcBox}
                onChange={(e) => setCalcBox(onlyDigits(e.target.value))}
                placeholder="예: 2006"
              />
            </label>
            <label className="calc-field">
              <span>박스입수</span>
              <input
                type="text"
                inputMode="numeric"
                value={calcLdu}
                onChange={(e) => setCalcLdu(onlyDigits(e.target.value))}
                placeholder="예: 20"
              />
            </label>
            <label className="calc-field">
              <span>권장 박스</span>
              <input
                type="text"
                inputMode="numeric"
                value={calcRecommendedBox}
                onChange={(e) => setCalcRecommendedBox(onlyDigits(e.target.value))}
                placeholder="예: 2006"
              />
            </label>
            <label className="calc-field">
              <span>적정 출고량 EA</span>
              <input
                type="text"
                inputMode="numeric"
                value={calcTargetEa}
                onChange={(e) => setCalcTargetEa(onlyDigits(e.target.value))}
                placeholder="예: 40120"
              />
            </label>
          </div>
          <div className="calc-result-grid">
            <article className="calc-result-card">
              <span>EA 환산</span>
              <strong>{calcEa.toLocaleString()}EA</strong>
              <small>{calcBoxNum.toLocaleString()}박스 × {calcLduNum.toLocaleString()}EA</small>
            </article>
            <article className={`calc-result-card ${calcDiffBox === 0 ? 'ok' : calcDiffBox > 0 ? 'high' : 'low'}`}>
              <span>권장 대비</span>
              <strong>{calcDiffBox >= 0 ? '+' : ''}{calcDiffBox.toLocaleString()}박스</strong>
              <small>{calcDiffEa >= 0 ? '+' : ''}{calcDiffEa.toLocaleString()}EA · {calcRecommendRatio.toFixed(1)}%</small>
            </article>
            <article className={`calc-result-card ${calcTargetTone}`}>
              <span>적정 대비 발주</span>
              <strong>{calcTargetRatio.toFixed(1)}%</strong>
              <small>{calcTargetStatus}</small>
            </article>
          </div>
          <div className="calc-actions">
            <button type="button" onClick={loadSelectedToCalculator} disabled={!selectedCalcRow}>
              선택 상품 불러오기
            </button>
            <button
              type="button"
              onClick={() => {
                setCalcBox('100')
                setCalcLdu('20')
                setCalcRecommendedBox('100')
                setCalcTargetEa('2000')
              }}
            >
              초기화
            </button>
          </div>
        </section>
      )}
      <header className="topbar">
        <div className="brand">
          <div className="logo">7</div>
          <div>
            <p>세븐일레븐</p>
            <h1>MD 신상품 초도발주 데모</h1>
          </div>
        </div>
      </header>

      <main className="container">
        <div className="tabs">
          <button className={`tab ${activeTab === '금주+MD' ? 'active' : ''}`} onClick={() => setActiveTab('금주+MD')}>금일 신상품 작업 <span>{newItemCount}</span></button>
          <button className={`tab ${activeTab === '과거' ? 'active' : ''}`} onClick={() => setActiveTab('과거')}>과거 신상품 조회</button>
        </div>
        {renderDashboardHero()}

        {activeTab === '금주+MD' ? (
          <>
            <section className="criteria-strip">
              <span className="criteria-label">판정 기준</span>
              <span className="kpi low">결품위험: 적정 출고량의 1배 미만</span>
              <span className="kpi ok">정상발주: 1.0~1.4배</span>
              <span className="kpi high">과발주: 1.4배 초과</span>
            </section>

            <section className="table-wrap">
              {weeklyRows.length === 0 && (
                <div className="empty-note">
                  현재 날짜 2025-12-26에는 오늘 확정할 신상품이 없습니다. 과거 신상품 조회에서 참고 사례를 확인할 수 있습니다.
                </div>
              )}
              <table>
                <thead>
                  <tr>
                    <th className="col-code">상품코드</th>
                    <th className="col-name">상품명</th>
                    <th className="col-release">출시일</th>
                    <th className="col-cat">카테고리</th>
                    <th className="col-price">판매가</th>
                    <th className="col-goal">목표/예측(GNN) 도입률</th>
                    <th className="col-rate">발주 적정도</th>
                    <th className="col-reco">권장/입력 발주량</th>
                    <th className="col-input">발주 수량 조정</th>
                    <th className="col-act">처리</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const intro = predictedIntroInfo(r)
                    const introTone = predictedIntroTone(r, intro)
                    const recommendedBox = mlRecommendBox(r)
                    const inputBox = currentInputBox(r)
                    const orderTone = qtyDeltaTone(r)
                    return (
                    <Fragment key={r.rowKey}>
                      <tr
                        className={selectedItemCode === r.rowKey ? 'row-selected' : ''}
                        onClick={() =>
                          setSelectedItemCode((prev) => (prev === r.rowKey ? '' : r.rowKey))
                        }
                      >
                        <td className="col-code code">{r.itemCode}</td>
                        <td className="col-name">
                          <div className="product-cell">
                            <strong>{r.itemName}</strong>
                            {reviewReasons(r).length > 0 && (
                              <div className="reason-badges">
                                {reviewReasons(r).map((reason) => (
                                  <span className={`reason-badge ${reason.tone}`} key={`${r.rowKey}-${reason.label}`}>{reason.label}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="col-release">
                          <span className="release-date-cell">{r.releaseDate || '-'}</span>
                        </td>
                        <td className="col-cat"><span className="cat">{r.category}</span></td>
                        <td className="col-price">
                          <div className="price-cell">
                            <strong className="price">₩{r.price.toLocaleString()}</strong>
                          </div>
                        </td>
                        <td className="col-goal">
                          <div
                            className="intro-rate-cell"
                            title={intro ? `예측 참여 ${intro.stores.toLocaleString()}점포 / 기준 ${intro.targetStores.toLocaleString()}점포${intro.count > 1 ? ` · 동일분류 ${intro.count}개 기반` : ''}` : '예측 도입률 데이터 없음'}
                          >
                            <p className="intro-rate-line target">
                              <span>목표</span>
                              <strong>{Number(r.goalIntroRate || 0).toFixed(1)}%</strong>
                            </p>
                            <p className={`intro-rate-line predicted ${introTone}`}>
                              <span>예측(GNN)</span>
                              <strong>{intro ? `${intro.rate.toFixed(1)}%` : '-'}</strong>
                            </p>
                          </div>
                        </td>
                        <td className="col-rate">
                          <div className="rate-inline">
                            <span className="rate-text">{currentOutflowRate(r)}%</span>
                            <div className="rate-track">
                              <div
                                className={`rate-fill ${pctColor(currentOutflowRate(r))}`}
                                style={{ width: `${Math.min(currentOutflowRate(r), 100)}%` }}
                              />
                            </div>
                          </div>
                          <p className={`qty-warn ${outflowBand(currentOutflowRate(r)) === 'over' ? 'high' : outflowBand(currentOutflowRate(r)) === 'shortage' ? 'low' : ''}`}>
                            {outflowBand(currentOutflowRate(r)) === 'over' ? '과발주' : outflowBand(currentOutflowRate(r)) === 'shortage' ? '결품위험' : '정상'}
                          </p>
                        </td>
                        <td className="col-reco">
                          <div className="order-compare-cell">
                            <p className="order-compare-line target">
                              <span>권장</span>
                              <strong>{recommendedBox.toLocaleString()}박스</strong>
                            </p>
                            <p className={`order-compare-line input ${orderTone}`}>
                              <span>입력</span>
                              <strong>{inputBox.toLocaleString()}박스</strong>
                            </p>
                          </div>
                        </td>
                        <td className="col-input">
                          <input
                            className={`qty-input ${qtyDeltaTone(r)}`}
                            value={qtyMap[r.rowKey] ?? ''}
                            placeholder="박스"
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const next = e.target.value.replace(/[^\d]/g, '')
                              setQtyMap((prev) => ({ ...prev, [r.rowKey]: next }))
                              setCenterQtyMap((prev) => ({ ...prev, [r.rowKey]: undefined }))
                              setConfirmedMap((prev) => ({ ...prev, [r.rowKey]: false }))
                            }}
                          />
                          <p className="qty-meta">
                            박스입수 {boxUnitEa(r).toLocaleString()}EA / EA 환산 {toEaFromBox(qtyMap[r.rowKey], boxUnitEa(r)).toLocaleString()}
                          </p>
                          {qtyDeltaTone(r) === 'high' && <p className="qty-warn high">권장 대비 과다 발주</p>}
                          {qtyDeltaTone(r) === 'low' && <p className="qty-warn low">권장 대비 과소 발주</p>}
                        </td>
                        <td className="col-act">
                          <div className="action-stack">
                            <button
                              className={`confirm ${confirmedMap[r.rowKey] ? 'done' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmedMap((prev) => ({ ...prev, [r.rowKey]: !prev[r.rowKey] }))
                              }}
                            >
                              {confirmedMap[r.rowKey] ? '확정 완료' : '발주 확정'}
                            </button>
                            <label className="action-note-select" onClick={(e) => e.stopPropagation()}>
                              <span>조정 사유</span>
                              <select
                                value={decisionNoteMap[r.rowKey] || '모델 추천 그대로'}
                                onChange={(event) => {
                                  event.stopPropagation()
                                  setDecisionNoteMap((prev) => ({ ...prev, [r.rowKey]: event.target.value }))
                                }}
                              >
                                <option value="모델 추천 그대로">모델추천</option>
                                <option value="유사상품 과발주 이력으로 감량">감량</option>
                                <option value="예약 반응 강해 증량">증량</option>
                                <option value="센터 편차 조정">센터조정</option>
                                <option value="공급/운영 이슈 반영">운영이슈</option>
                                <option value="MD 수기 판단">MD판단</option>
                              </select>
                            </label>
                          </div>
                        </td>
                      </tr>
                      {selectedItemCode === r.rowKey && data?.itemDetails?.[r.rowKey] && (
                        <tr className="expand-row today-inline-expand">
                          <td colSpan={10}>
                            {(() => {
                              const intro = predictedIntroInfo(r)
                              const goalIntro = Number(r.goalIntroRate || 0)
                              const introDelta = intro ? intro.rate - goalIntro : 0
                              const ldu = boxUnitEa(r)
                              const recommendedBox = mlRecommendBox(r)
                              const inputBox = currentInputBox(r)
                              const inputEa = Math.round(inputBox * ldu)
                              const orderAmount = inputEa * Number(r.price || 0)
                              const centers = centersForRow(r)
                              const baseCenterBoxes = baseCenterBoxMap(r)
                              const maxCenterBox = Math.max(...centers.map((c) => Number(c.qty || 0)), ...Object.values(baseCenterBoxes).map((x) => Number(x || 0)), 1)
                              const dragMax = Math.ceil(maxCenterBox * 1.25)
                              const productSummary = renderProductInfoSummary(r)
                              const reservationTrend = renderDrawerReservationTrend(r)
                              const inlineTabs = [
                                { key: 'basic', label: '상품 기본 정보', meta: '정보서·유사상품' },
                                { key: 'reservation', label: '예약 정보', meta: '일자별·누적' },
                                { key: 'gnn', label: '수요 네트워크', meta: 'GNN 기반' },
                                { key: 'lifecycle', label: '제품 생애주기', meta: '출시 후 흐름' },
                                { key: 'ai', label: '최종 판단', meta: '규칙 기반 예시' },
                              ]
                              const activeInlineTab = inlineTabs.some((tab) => tab.key === drawerDetailTab) ? drawerDetailTab : 'basic'
                              const delta = orderDeltaSummary(r)

                              return (
                                <div className="today-inline-detail">
                                  <article className="viz-card today-inline-left">
                                    <nav className="inline-detail-tabs" aria-label="상품 상세 정보 탭">
                                      {inlineTabs.map((tab) => (
                                        <button
                                          type="button"
                                          key={tab.key}
                                          className={activeInlineTab === tab.key ? 'active' : ''}
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            setDrawerDetailTab(tab.key)
                                          }}
                                        >
                                          <strong>{tab.label}</strong>
                                          <span>{tab.meta}</span>
                                        </button>
                                      ))}
                                    </nav>

                                    <div className="inline-detail-content">
                                      <div className="inline-detail-head">
                                        <div>
                                          <div className="today-drawer-tags">
                                            <span>{r.itemCode}</span>
                                            <span>출시 {r.releaseDate || '-'}</span>
                                            <span>{r.category}</span>
                                            <span className={outflowBand(currentOutflowRate(r)) === 'over' ? 'high' : outflowBand(currentOutflowRate(r)) === 'shortage' ? 'low' : 'ok'}>
                                              {outflowBand(currentOutflowRate(r)) === 'over' ? '과발주' : outflowBand(currentOutflowRate(r)) === 'shortage' ? '결품위험' : '정상'}
                                            </span>
                                          </div>
                                          <h3>{r.itemName}</h3>
                                          <p>판매가 ₩{Number(r.price || 0).toLocaleString()} · 박스입수 {ldu.toLocaleString()}EA</p>
                                        </div>
                                      </div>

                                      {activeInlineTab === 'basic' && (
                                        <div className="inline-tab-panel basic-inline-panel">
                                          {renderProductBasicPanel(r)}
                                          {productSummary}
                                          {renderSimilarHistory(r, 4)}
                                        </div>
                                      )}

                                      {activeInlineTab === 'reservation' && (
                                        <div className="inline-tab-panel">
                                          {reservationTrend || <p className="drawer-empty-note">예약주문 추세 데이터가 없습니다.</p>}
                                        </div>
                                      )}

                                      {activeInlineTab === 'gnn' && (
                                        <div className="inline-tab-panel">
                                          {renderInlineGnnNetwork(r)}
                                        </div>
                                      )}

                                      {activeInlineTab === 'lifecycle' && (
                                        <div className="inline-tab-panel">
                                          {renderInlineLifecyclePanel(r)}
                                        </div>
                                      )}

                                      {activeInlineTab === 'ai' && (
                                        <div className="inline-tab-panel">
                                          <section className="inline-section inline-evidence-wrap">
                                            {renderRecommendationEvidence(r)}
                                            {renderDrawerAiReview(r)}
                                          </section>
                                        </div>
                                      )}
                                    </div>
                                  </article>

                                  <article className="viz-card center-side-card today-inline-center">
                                    <h3>센터별 분배 수량</h3>
                                    <div className="center-control-panel">
                                      <div className={`order-delta ${delta.tone}`}>
                                        <strong>
                                          <em>변경 전/후</em>
                                          모델 {delta.recoBox.toLocaleString()}박스 → 현재 {delta.inputBox.toLocaleString()}박스
                                        </strong>
                                        <span>
                                          {delta.deltaBox === 0 ? '모델 추천과 동일' : `${delta.deltaBox > 0 ? '+' : ''}${delta.deltaBox.toLocaleString()}박스 · ${delta.deltaEa > 0 ? '+' : ''}${delta.deltaEa.toLocaleString()}EA`}
                                        </span>
                                      </div>
                                      <div className="center-control-actions">
                                        <button
                                          type="button"
                                          className="mini-reset"
                                          onClick={(event) => {
                                            event.stopPropagation()
                                            resetOrderToRecommended(r)
                                          }}
                                        >
                                          모델 추천값으로 초기화
                                        </button>
                                      </div>
                                    </div>
                                    <div className="center-bars">
                                      {centers.map((c) => {
                                        const tone = centerTone(r, c.centerName, c.qty)
                                        const baseCenterBox = Number(baseCenterBoxes[c.centerName] || 0)
                                        const fillWidth = Math.max(c.qty > 0 ? 3 : 0, Math.min(100, (c.qty / dragMax) * 100))
                                        const baseWidth = Math.max(baseCenterBox > 0 ? 3 : 0, Math.min(100, (baseCenterBox / dragMax) * 100))
                                        const keyStep = Math.max(1, Math.round(Math.max(baseCenterBox, 1) * 0.02))
                                        return (
                                          <div
                                            key={c.centerName}
                                            className="center-row"
                                            data-tooltip={`권장 ${baseCenterBox.toLocaleString()}박스 · 입력 ${Number(c.qty || 0).toLocaleString()}박스 · EA ${Math.round(Number(c.qty || 0) * ldu).toLocaleString()}`}
                                          >
                                            <span>{c.centerName}</span>
                                            <div
                                              className="center-track editable"
                                              role="slider"
                                              tabIndex={0}
                                              aria-label={`${c.centerName} 발주 박스 수량`}
                                              aria-valuemin={0}
                                              aria-valuemax={dragMax}
                                              aria-valuenow={Number(c.qty || 0)}
                                              onClick={(event) => event.stopPropagation()}
                                              onPointerDown={(event) => {
                                                event.currentTarget.setPointerCapture?.(event.pointerId)
                                                updateCenterBoxFromPointer(event, r, centers, c.centerName, dragMax)
                                              }}
                                              onPointerMove={(event) => {
                                                if (event.buttons !== 1) return
                                                updateCenterBoxFromPointer(event, r, centers, c.centerName, dragMax)
                                              }}
                                              onPointerUp={(event) => {
                                                event.stopPropagation()
                                                event.currentTarget.releasePointerCapture?.(event.pointerId)
                                              }}
                                              onKeyDown={(event) => {
                                                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                                                event.preventDefault()
                                                event.stopPropagation()
                                                if (event.key === 'Home') updateCenterBoxQty(r, centers, c.centerName, 0)
                                                else if (event.key === 'End') updateCenterBoxQty(r, centers, c.centerName, dragMax)
                                                else updateCenterBoxQty(r, centers, c.centerName, Number(c.qty || 0) + (event.key === 'ArrowRight' ? keyStep : -keyStep))
                                              }}
                                            >
                                              <div className={`center-fill ${tone}`} style={{ width: `${fillWidth}%` }} />
                                              <span
                                                className="center-baseline"
                                                style={{ left: `${baseWidth}%` }}
                                                title={`모델 권장 기준 ${baseCenterBox.toLocaleString()}박스로 되돌리기`}
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => {
                                                  event.stopPropagation()
                                                  resetCenterToRecommended(r, centers, c.centerName)
                                                }}
                                                aria-label={`${c.centerName} 모델 권장 기준으로 되돌리기`}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(event) => {
                                                  if (event.key !== 'Enter' && event.key !== ' ') return
                                                  event.preventDefault()
                                                  event.stopPropagation()
                                                  resetCenterToRecommended(r, centers, c.centerName)
                                                }}
                                              />
                                              <i className={`center-handle ${tone}`} style={{ left: `${fillWidth}%` }} aria-hidden="true" />
                                            </div>
                                            <div className="center-edit">
                                              <input
                                                className={`center-qty-input ${tone}`}
                                                value={String(c.qty)}
                                                onClick={(event) => event.stopPropagation()}
                                                onChange={(event) => {
                                                  const next = event.target.value.replace(/[^\d]/g, '')
                                                  updateCenterBoxQty(r, centers, c.centerName, next)
                                                }}
                                              />
                                              <small>EA {Math.round(Number(c.qty || 0) * ldu).toLocaleString()} · 권장 {baseCenterBox.toLocaleString()}박스</small>
                                              {tone === 'high' && <small className="center-warn high">과발주 주의</small>}
                                              {tone === 'low' && <small className="center-warn low">결품 주의</small>}
                                              {tone === 'ok' && <small className="center-warn ok">정상범위</small>}
                                              {!tone && <small className="center-warn neutral">수량 확인</small>}
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </article>
                                </div>
                              )
                            })()}
                          </td>
                        </tr>
                      )}
                      {false && selectedItemCode === r.rowKey && data?.itemDetails?.[r.rowKey] && (
                        <tr className="expand-row">
                          <td colSpan={9}>
                            <div className="expanded-detail-stack">
                            <div className="inline-viz-grid">
                              <article className="viz-card current-reason-side">
                                {(() => {
                                  const reservation = data.itemDetails[r.rowKey].reservation4d || []
                                  const reservationCumulative = reservation.reduce((acc, p, idx) => {
                                    const prev = idx > 0 ? acc[idx - 1].qty : 0
                                    acc.push({ date: p.date, qty: prev + Number(p.qty || 0) })
                                    return acc
                                  }, [])
                                  const overlayBounds = {
                                    min: 0,
                                    max: Math.max(
                                      ...reservation.map((p) => Number(p.qty || 0)),
                                      ...reservationCumulative.map((p) => Number(p.qty || 0)),
                                      1,
                                    ),
                                  }
                                  const dateRangeLabel = reservation.length
                                    ? `${formatMd(reservation[0].date)} ~ ${formatMd(reservation[reservation.length - 1].date)}`
                                    : ''
                                  return (
                                    <>
                                      <div className="current-chart-head">
                                        <h3>예약주문 추세선</h3>
                                        <span>{dateRangeLabel}</span>
                                      </div>
                                      <div className="current-trend-panel">
                                        <div className="current-trend-subhead">
                                          <strong>실선: 일자별 예약주문 · 점선: 누적 예약주문</strong>
                                        </div>
                                        <svg className="trend-line current-overlay-trend" viewBox="0 0 560 230" role="img" aria-label="일자별 및 누적 예약 주문 추세선">
                                          {chartGrid(560, 230, 34, `current-${r.rowKey}`)}
                                          <path d={buildAreaPath(reservationCumulative, 560, 230, 34, overlayBounds)} fill="#dbeafe" opacity="0.58" />
                                          <path d={buildLinePath(reservationCumulative, 560, 230, 34, overlayBounds)} fill="none" stroke="#2563eb" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="7 6" />
                                          <path d={buildAreaPath(reservation, 560, 230, 34, overlayBounds)} fill="#dcfce7" opacity="0.52" />
                                          <path d={buildLinePath(reservation, 560, 230, 34, overlayBounds)} fill="none" stroke="#0c7a43" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
                                          {reservationCumulative.map((p, idx) => {
                                            const { x, y } = pointXY(p, idx, reservationCumulative, 560, 230, 34, overlayBounds)
                                            const isLast = idx === reservationCumulative.length - 1
                                            if (idx === 0) return null
                                            return (
                                              <g key={`cum-${p.date}`}>
                                                <circle cx={x} cy={y} r={isLast ? 5 : 3.8} fill="#2563eb" stroke="#f8fafc" strokeWidth="2.5" />
                                                <circle
                                                  className="chart-hover-target"
                                                  cx={x}
                                                  cy={y}
                                                  r="12"
                                                  fill="transparent"
                                                  onMouseEnter={(event) => showChartTooltip(event, [p.date, `누적 예약주문 ${Number(p.qty || 0).toLocaleString()}EA`])}
                                                  onMouseMove={moveChartTooltip}
                                                  onMouseLeave={() => setChartTooltip(null)}
                                                />
                                                {isLast && (
                                                  <text x={x - 4} y={Math.max(16, y - 12)} textAnchor="end" fontSize="10.5" fontWeight="800" fill="#1e3a8a" stroke="#f8fafc" strokeWidth="4" paintOrder="stroke">
                                                    누적 {Number(p.qty || 0).toLocaleString()}
                                                  </text>
                                                )}
                                              </g>
                                            )
                                          })}
                                          {reservation.map((p, idx) => {
                                            const { x, y } = pointXY(p, idx, reservation, 560, 230, 34, overlayBounds)
                                            const cumulativePoint = reservationCumulative[idx]
                                            const cumulativeY = cumulativePoint
                                              ? pointXY(cumulativePoint, idx, reservationCumulative, 560, 230, 34, overlayBounds).y
                                              : -999
                                            const preferredY = y < 48 ? y + 26 : y - 14
                                            const collidesWithCumulative = Math.abs(preferredY - cumulativeY) < 22
                                            const labelY = collidesWithCumulative ? Math.min(y + 28, 194) : preferredY
                                            return (
                                              <g key={p.date}>
                                                <circle cx={x} cy={y} r="5.5" fill="#0c7a43" stroke="#f8fafc" strokeWidth="3" />
                                                <circle
                                                  className="chart-hover-target"
                                                  cx={x}
                                                  cy={y}
                                                  r="14"
                                                  fill="transparent"
                                                  onMouseEnter={(event) => showChartTooltip(event, [p.date, `일자별 예약주문 ${Number(p.qty || 0).toLocaleString()}EA`])}
                                                  onMouseMove={moveChartTooltip}
                                                  onMouseLeave={() => setChartTooltip(null)}
                                                />
                                                <text x={x} y={labelY} textAnchor="middle" fontSize="11" fontWeight="800" fill="#14532d" stroke="#f8fafc" strokeWidth="4" paintOrder="stroke">
                                                  {Number(p.qty || 0).toLocaleString()}
                                                </text>
                                                <text x={x} y={216} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#64748b">
                                                  {formatMd(p.date)}
                                                </text>
                                              </g>
                                            )
                                          })}
                                        </svg>
                                      </div>
                                    </>
                                  )
                                })()}
                                {(() => {
                                  const evidence = data.itemDetails[r.rowKey].recommendationEvidence || {}
                                  const reservation = data.itemDetails[r.rowKey].reservation4d || []
                                  const reservationSum = Number(evidence.reservationDecisionSum || reservation.reduce((acc, p) => acc + Number(p.qty || 0), 0))
                                  const first4 = Number(evidence.reservationInitial4Sum || 0)
                                  const similarAvgOrder = Number(evidence.similarAvgOrderQty || 0)
                                  const similarAvgBox = Math.round(similarAvgOrder / boxUnitEa(r))
                                  const similarAvgRate = Number(evidence.similarAvgAdequacyRate || 0)
                                  const frontloadRatio = Number(evidence.frontloadRatio || 0)
                                  const mdReasonPayload = buildMdReasonPayload(r, evidence)
                                  const oneLineReview = buildMdOneLineReview(mdReasonPayload)
                                  return (
                                    <article className="recommendation-evidence-card">
                                      <div className="evidence-head">
                                        <div>
                                          <h3>권장 발주량 검토 근거</h3>
                                        </div>
                                        <div className="evidence-actions">
                                          <span className="kpi ok">합성 예시</span>
                                          <span className="kpi diff">MD 검토용</span>
                                        </div>
                                      </div>
                                      <div className="gemini-inline-opinion">
                                        <strong>규칙 기반 검토 의견</strong>
                                        <span>{oneLineReview}</span>
                                      </div>
                                      <div className="evidence-metrics">
                                        <div>
                                          <small>예약 수요 규모</small>
                                          <strong>{reservationSum.toLocaleString()}EA</strong>
                                          <span>출시 전 들어온 총 예약주문</span>
                                        </div>
                                        <div>
                                          <small>초반 몰림 정도</small>
                                          <strong>{first4.toLocaleString()}EA</strong>
                                          <span>초기 비중 {frontloadRatio.toFixed(1)}%</span>
                                        </div>
                                        <div>
                                          <small>비슷한 상품 평균 발주</small>
                                          <strong>{similarAvgBox.toLocaleString()}박스</strong>
                                          <span>EA {similarAvgOrder.toLocaleString()} · 과거 유사 사례 기준</span>
                                        </div>
                                        <div>
                                          <small>비슷한 상품 발주 적정성</small>
                                          <strong>{similarAvgRate.toFixed(1)}%</strong>
                                          <span>1.0~1.4배면 정상 범위</span>
                                        </div>
                                      </div>
                                    </article>
                                  )
                                })()}
                                {renderSimilarHistory(r, 4)}
                              </article>

                              <article className="viz-card center-side-card">
                                <h3>센터별 분배 수량</h3>
                                {(() => {
                                  const centers = centersForRow(r)
                                  const baseCenterBoxes = baseCenterBoxMap(r)
                                  const max = Math.max(...centers.map((x) => x.qty), 1)
                                  const dragMax = Math.ceil(Math.max(max, ...Object.values(baseCenterBoxes).map((x) => Number(x || 0)), 1) * 1.25)
                                  const delta = orderDeltaSummary(r)
                                  return (
                                    <>
                                      <div className="center-control-panel">
                                        <div className={`order-delta ${delta.tone}`}>
                                          <strong>
                                            <em>변경 전/후</em>
                                            모델 {delta.recoBox.toLocaleString()}박스 → 현재 {delta.inputBox.toLocaleString()}박스
                                          </strong>
                                          <span>
                                            {delta.deltaBox === 0 ? '모델 추천과 동일' : `${delta.deltaBox > 0 ? '+' : ''}${delta.deltaBox.toLocaleString()}박스 · ${delta.deltaEa > 0 ? '+' : ''}${delta.deltaEa.toLocaleString()}EA`}
                                          </span>
                                        </div>
                                        <div className="center-control-actions">
                                          <button
                                            type="button"
                                            className="mini-reset"
                                            onClick={(event) => {
                                              event.stopPropagation()
                                              resetOrderToRecommended(r)
                                            }}
                                          >
                                            모델 추천값으로 초기화
                                          </button>
                                        </div>
                                      </div>
                                      <div className="center-bars">
                                        {centers.map((c) => {
                                          const ldu = boxUnitEa(r)
                                          const tone = centerTone(r, c.centerName, c.qty)
                                          const baseCenterBox = Number(baseCenterBoxes[c.centerName] || 0)
                                          const fillWidth = Math.max(c.qty > 0 ? 3 : 0, Math.min(100, (c.qty / dragMax) * 100))
                                          const baseWidth = Math.max(baseCenterBox > 0 ? 3 : 0, Math.min(100, (baseCenterBox / dragMax) * 100))
                                          const keyStep = Math.max(1, Math.round(Math.max(baseCenterBox, 1) * 0.02))
                                          return (
                                          <div
                                            key={c.centerName}
                                            className="center-row"
                                            data-tooltip={`권장 ${baseCenterBox.toLocaleString()}박스 · 입력 ${Number(c.qty || 0).toLocaleString()}박스 · EA ${Math.round(Number(c.qty || 0) * ldu).toLocaleString()}`}
                                          >
                                            <span>{c.centerName}</span>
                                            <div
                                              className="center-track editable"
                                              role="slider"
                                              tabIndex={0}
                                              aria-label={`${c.centerName} 발주 박스 수량`}
                                              aria-valuemin={0}
                                              aria-valuemax={dragMax}
                                              aria-valuenow={Number(c.qty || 0)}
                                              onClick={(event) => event.stopPropagation()}
                                              onPointerDown={(event) => {
                                                event.currentTarget.setPointerCapture?.(event.pointerId)
                                                updateCenterBoxFromPointer(event, r, centers, c.centerName, dragMax)
                                              }}
                                              onPointerMove={(event) => {
                                                if (event.buttons !== 1) return
                                                updateCenterBoxFromPointer(event, r, centers, c.centerName, dragMax)
                                              }}
                                              onPointerUp={(event) => {
                                                event.stopPropagation()
                                                event.currentTarget.releasePointerCapture?.(event.pointerId)
                                              }}
                                              onKeyDown={(event) => {
                                                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                                                event.preventDefault()
                                                event.stopPropagation()
                                                if (event.key === 'Home') updateCenterBoxQty(r, centers, c.centerName, 0)
                                                else if (event.key === 'End') updateCenterBoxQty(r, centers, c.centerName, dragMax)
                                                else updateCenterBoxQty(r, centers, c.centerName, Number(c.qty || 0) + (event.key === 'ArrowRight' ? keyStep : -keyStep))
                                              }}
                                            >
                                              <div className={`center-fill ${tone}`} style={{ width: `${fillWidth}%` }} />
                                              <span
                                                className="center-baseline"
                                                style={{ left: `${baseWidth}%` }}
                                                title={`모델 권장 기준 ${baseCenterBox.toLocaleString()}박스로 되돌리기`}
                                                onPointerDown={(event) => {
                                                  event.stopPropagation()
                                                }}
                                                onClick={(event) => {
                                                  event.stopPropagation()
                                                  resetCenterToRecommended(r, centers, c.centerName)
                                                }}
                                                aria-label={`${c.centerName} 모델 권장 기준으로 되돌리기`}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(event) => {
                                                  if (event.key !== 'Enter' && event.key !== ' ') return
                                                  event.preventDefault()
                                                  event.stopPropagation()
                                                  resetCenterToRecommended(r, centers, c.centerName)
                                                }}
                                              />
                                              <i className={`center-handle ${tone}`} style={{ left: `${fillWidth}%` }} aria-hidden="true" />
                                            </div>
                                            <div className="center-edit">
                                              <input
                                                className={`center-qty-input ${tone}`}
                                                value={String(c.qty)}
                                                onClick={(e) => e.stopPropagation()}
                                                onChange={(e) => {
                                                  const next = e.target.value.replace(/[^\d]/g, '')
                                                  updateCenterBoxQty(r, centers, c.centerName, next)
                                                }}
                                              />
                                              <small>{Number(c.qty || 0).toLocaleString()}박스 / EA {Math.round(Number(c.qty || 0) * ldu).toLocaleString()}</small>
                                              <small>권장 발주량 {baseCenterBox.toLocaleString()}박스</small>
                                              {tone === 'high' && <small className="center-warn high">과발주 주의</small>}
                                              {tone === 'low' && <small className="center-warn low">결품 주의</small>}
                                              {tone === 'ok' && <small className="center-warn ok">정상범위</small>}
                                              {!tone && <small className="center-warn neutral">수량 확인</small>}
                                            </div>
                                          </div>
                                        )})}
                                      </div>
                                    </>
                                  )
                                })()}
                              </article>
                            </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </section>

          </>
        ) : activeTab === '과거' ? (
          <>
          <section className="past-hero">
            <div className="past-hero-copy">
              <span>과거 신상품 조회</span>
              <strong>{mdDisplayName}, 과거 과자 신상품의 초도 발주와 출시 후 성과를 비교할 수 있습니다.</strong>
              <p>분류·출시일·상품명을 기준으로 실제 초도, 센터 출고율, 점포 소화율, 목표/예측(GNN) 도입률을 함께 확인하세요.</p>
            </div>
            <div className="past-hero-stats">
              <article>
                <small>조회 상품</small>
                <strong>{filteredPastRows.length.toLocaleString()}개</strong>
              </article>
              <article>
                <small>과발주 사례</small>
                <strong>{filteredPastRows.filter((r) => Number(r.salesRate || 0) > 140).length.toLocaleString()}개</strong>
              </article>
              <article>
                <small>정상 범위</small>
                <strong>{filteredPastRows.filter((r) => Number(r.salesRate || 0) >= 100 && Number(r.salesRate || 0) <= 140).length.toLocaleString()}개</strong>
              </article>
            </div>
          </section>
          <section className="past-filter-panel">
            <div className="past-filter-field date-range">
              <label>출시일</label>
              <div className="date-range-inputs">
                <input type="date" value={pastDateFrom} onChange={(e) => setPastDateFrom(e.target.value)} />
                <span>~</span>
                <input type="date" value={pastDateTo} onChange={(e) => setPastDateTo(e.target.value)} />
              </div>
            </div>
            <div className="past-filter-field">
              <label>대분류</label>
              <select
                value={pastCategory}
                onChange={(e) => {
                  setPastCategory(e.target.value)
                  setPastCategoryMid('전체')
                  setPastCategorySub('전체')
                }}
              >
                {pastCategoryOptions.map((c) => <option key={`cat-${c}`} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="past-filter-field">
              <label>중분류</label>
              <select
                value={pastCategoryMid}
                onChange={(e) => {
                  setPastCategoryMid(e.target.value)
                  setPastCategorySub('전체')
                }}
              >
                {pastCategoryMidOptions.map((c) => <option key={`mid-${c}`} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="past-filter-field">
              <label>소분류</label>
              <select value={pastCategorySub} onChange={(e) => setPastCategorySub(e.target.value)}>
                {pastCategorySubOptions.map((c) => <option key={`sub-${c}`} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="past-filter-field compact">
              <label>정렬</label>
              <select value={pastSort} onChange={(e) => setPastSort(e.target.value)}>
                <option value="latest">최신순</option>
                <option value="high_rate">초도/적정 높은순</option>
                <option value="low_rate">초도/적정 낮은순</option>
                <option value="high_qty">발주량 높은순</option>
              </select>
            </div>
            <div className="past-filter-field search-field">
              <label>검색</label>
              <input
                type="text"
                className="search"
                placeholder="상품명/코드 검색"
                value={pastQuery}
                onChange={(e) => setPastQuery(e.target.value)}
              />
            </div>
            <div className="past-filter-actions">
              <button
                className="ghost"
                onClick={() => {
                  const headers = ['출시일', '상품코드', '상품명', '대분류', '중분류', '소분류', '목표도입률', '예측도입률', '예측도입률 출처', '발주량(박스)', '발주량(EA)', '출고율', '소화율', '초도/적정', '사유']
                  const lines = filteredPastRows.map((r) => {
                    const ldu = boxUnitEa(r)
                    const intro = predictedIntroInfo(r)
                    return [r.releaseDate, r.itemCode, r.itemName, r.category, r.categoryMid, r.categorySub, r.goalIntroRate, intro?.rate ?? '', intro?.source ?? '', Math.round(Number(r.actualOrderQty || 0) / ldu), r.actualOrderQty, r.outflowRate || r.actualOutflowRate || 0, r.salesDepletionRate || 0, r.salesRate, r.actualDataReason || '']
                  })
                  const csv = [headers, ...lines].map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
                  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `past-items-${new Date().toISOString().slice(0, 10)}.csv`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                엑셀 다운로드
              </button>
            </div>
          </section>
          <section className="criteria-strip">
            <span className="criteria-label">판정 기준</span>
            <span className="kpi low">결품위험: 적정 출고량의 1배 미만</span>
            <span className="kpi ok">정상발주: 1.0~1.4배</span>
            <span className="kpi high">과발주: 1.4배 초과</span>
          </section>

          <section className="table-wrap">
            {filteredPastRows.length === 0 && (
              <div className="empty-note">선택한 필터에 해당하는 과거 상품이 없습니다. 필터를 전체로 변경해 보세요.</div>
            )}
            <table className="past-table">
              <thead>
                <tr>
                  <th className="past-col-code">상품코드</th>
                  <th className="past-col-name">상품명</th>
                  <th className="past-col-date">출시일</th>
                  <th className="past-col-major">대분류</th>
                  <th className="past-col-mid">중분류</th>
                  <th className="past-col-sub">소분류</th>
                  <th className="past-col-goal">목표/예측(GNN) 도입률</th>
                  <th className="past-col-qty">과거 발주량(박스)</th>
                  <th className="past-col-rate">출고율</th>
                  <th className="past-col-rate">소화율</th>
                  <th className="past-col-rate">초도/적정</th>
                </tr>
              </thead>
              <tbody>
                {filteredPastRows.map((row) => {
                  const pastDetail = data?.itemDetails?.[`${row.itemCode}_${row.releaseDate}`]
                  const reservation4d = pastDetail?.reservation4d || []
                  const reservationPre = pastDetail?.reservationPreRelease || reservation4d
                  const centerDist = pastDetail?.centerDistribution || []
                  const centerPerf = pastDetail?.centerPerformance7d || []
                  const postReleaseOutflow7d = pastDetail?.postReleaseOutflow7d || []
                  const postReleaseStoreSales = pastDetail?.postReleaseStoreSales || []
                  const horizonDays = Number(pastDetail?.outflowHorizonDays || row.outflowHorizonDays || 4)
                  const centerMax = Math.max(...centerDist.map((c) => Number(c.qty || 0)), 1)
                  const reservationPreCumulative = reservationPre.reduce((acc, p, idx) => {
                    const prev = idx > 0 ? acc[idx - 1].qty : 0
                    acc.push({ date: p.date, qty: prev + Number(p.qty || 0) })
                    return acc
                  }, [])
                  const postReleaseOutflow7dCumulative = postReleaseOutflow7d.reduce((acc, p, idx) => {
                    const prev = idx > 0 ? acc[idx - 1].qty : 0
                    acc.push({ date: p.date, qty: prev + Number(p.qty || 0) })
                    return acc
                  }, [])
                  const postReleaseStoreSalesCumulative = postReleaseStoreSales.reduce((acc, p, idx) => {
                    const prev = idx > 0 ? acc[idx - 1].qty : 0
                    acc.push({ date: p.date, qty: prev + Number(p.qty || 0), amount: Number(p.amount || 0) })
                    return acc
                  }, [])
                  const preDecisionSum = Number(pastDetail?.reservationPre4dSum ?? reservation4d.reduce((s, p) => s + Number(p.qty || 0), 0))
                  const preTotalSum = Number(pastDetail?.reservationPreTotalSum ?? reservationPre.reduce((s, p) => s + Number(p.qty || 0), 0))
                  const storeSalesQty = Number(pastDetail?.postReleaseStoreSalesQty ?? row.actualStoreSalesQty ?? postReleaseStoreSales.reduce((s, p) => s + Number(p.qty || 0), 0))
                  const centerPerfByName = Object.fromEntries(centerPerf.map((c) => [c.centerName, c]))
                  const centerPerfMap = Object.fromEntries(centerPerf.map((c) => [c.centerName, Number(c.orderAdequacyRate || 0)]))
                  const unifiedSeries = [
                    ...reservationPre.map((x) => Number(x.qty || 0)),
                    ...reservationPreCumulative.map((x) => Number(x.qty || 0)),
                    ...postReleaseOutflow7d.map((x) => Number(x.qty || 0)),
                    ...postReleaseOutflow7dCumulative.map((x) => Number(x.qty || 0)),
                    ...postReleaseStoreSalesCumulative.map((x) => Number(x.qty || 0)),
                  ]
                  const unifiedBounds = {
                    min: 0,
                    max: Math.max(...unifiedSeries, 1),
                  }
                  const modelFormula = pastDetail?.formula || {}
                  const pastLdu = boxUnitEa(row)
                  const toPastBox = (qty) => Math.round(Number(qty || 0) / pastLdu)
                  const mlEa = Number(modelFormula.calibratedQtyReco || modelFormula.totalRecommendQty || 0)
                  const rawModelEa = Number(modelFormula.modelQty || 0)
                  const fixedFormulaEa = Number(modelFormula.formulaFixedQty || 0)
                  const recalFormulaEa = Number(modelFormula.formulaRecalQty || 0)
                  const mlBox = toPastBox(mlEa)
                  const rawModelBox = toPastBox(rawModelEa)
                  const fixedFormulaBox = toPastBox(fixedFormulaEa)
                  const recalFormulaBox = toPastBox(recalFormulaEa)
                  const alphaRecommended = Number(modelFormula.alphaRecommended || 0)
                  const actualEa = Number(row.actualOrderQty || 0)
                  const actualBox = toPastBox(actualEa)
                  const mlGapEa = actualEa - mlEa
                  const mlGapBox = actualBox - mlBox
                  const mlGapPct = mlEa > 0 ? Math.round((mlGapEa / mlEa) * 1000) / 10 : 0
                  const actualVsMlRatio = mlEa > 0 ? actualEa / mlEa : 0
                  const compareLabel = mlEa <= 0 ? '비교 불가' : actualVsMlRatio > 1.1 ? '과대 발주' : actualVsMlRatio < 0.9 ? '과소 발주' : '적정 발주'
                  const compareClass = compareLabel === '과대 발주' ? 'high' : compareLabel === '과소 발주' ? 'low' : compareLabel === '적정 발주' ? 'ok' : ''
                  const outflow7d = Number(row.actualOutflow7d || 0)
                  const normalMinEa = outflow7d
                  const normalMaxEa = Math.round(outflow7d * 1.4)
                  const normalMinBox = toPastBox(normalMinEa)
                  const normalMaxBox = toPastBox(normalMaxEa)
                  const outflowRate = Number(row.outflowRate ?? row.actualOutflowRate ?? 0)
                  const depletionRate = Number(row.salesDepletionRate ?? 0)
                  const adequacyRate = Number(row.salesRate || 0)
                  const pastRateBand = outflowBand(adequacyRate)
                  const pastQtyTone = pastRateBand === 'over' ? 'high' : pastRateBand === 'shortage' ? 'low' : 'ok'
                  const pastOrderBox = toPastBox(row.actualOrderQty)
                  const intro = predictedIntroInfo(row)
                  const introTone = predictedIntroTone(row, intro)
                  return (
                  <Fragment key={row.rowKey}>
                  <tr
                    className={Number(row.actualOrderQty || 0) <= 0 ? 'row-disabled' : ''}
                    onClick={() => {
                      if (Number(row.actualOrderQty || 0) <= 0) return
                      setPastExpandedKey((prev) => (prev === row.rowKey ? '' : row.rowKey))
                    }}
                    title={Number(row.actualOrderQty || 0) <= 0 ? '과거 발주량 0건은 상세 조회를 제공하지 않습니다.' : ''}
                  >
                    <td className="past-col-code">{row.itemCode}</td>
                    <td className="past-col-name">{row.itemName}</td>
                    <td className="past-col-date">{row.releaseDate}</td>
                    <td className="past-col-major"><span className="cat">{row.category}</span></td>
                    <td className="past-col-mid">{row.categoryMid}</td>
                    <td className="past-col-sub">{row.categorySub}</td>
                    <td className="past-col-goal">
                      <div
                        className="intro-rate-cell"
                        title={intro ? `예측 참여 ${intro.stores.toLocaleString()}점포 / 기준 ${intro.targetStores.toLocaleString()}점포${intro.count > 1 ? ` · 동일분류 ${intro.count}개 기반` : ''}` : '예측 도입률 데이터 없음'}
                      >
                        <p className="intro-rate-line target">
                          <span>목표</span>
                          <strong>{Number(row.goalIntroRate || 0).toFixed(1)}%</strong>
                        </p>
                        <p className={`intro-rate-line predicted ${introTone}`}>
                          <span>예측(GNN)</span>
                          <strong>{intro ? `${intro.rate.toFixed(1)}%` : '-'}</strong>
                        </p>
                      </div>
                    </td>
                    <td className="past-col-qty qty">
                      <span className={`past-order-value ${pastQtyTone}`}>{pastOrderBox.toLocaleString()}박스</span>
                      <small className="cell-reason">박스입수 {boxUnitEa(row).toLocaleString()}EA / EA 환산 {Number(row.actualOrderQty || 0).toLocaleString()}</small>
                      {row.actualDataReason ? <small className="cell-reason">{row.actualDataReason}</small> : null}
                    </td>
                    <td className="past-col-rate">
                      {outflowRate.toFixed(1)}%
                      <small className="cell-reason">센터출고/초도</small>
                    </td>
                    <td className="past-col-rate">
                      {depletionRate.toFixed(1)}%
                      <small className="cell-reason">점포판매/초도</small>
                    </td>
                    <td className="past-col-rate">
                      {adequacyRate}%
                      {row.actualDataReason ? <small className="cell-reason">{row.actualDataReason}</small> : null}
                    </td>
                  </tr>
                  {pastExpandedKey === row.rowKey && Number(row.actualOrderQty || 0) > 0 && (
                    <tr className="expand-row">
                      <td colSpan={11}>
                        <div className="inline-viz-grid past-detail-grid">
                          <article className="viz-card stacked-chart-card">
                            {reservationPre.length > 0 ? (
                              <>
                                <div className="chart-block">
                                  <h3>예약주문 수량 시각화</h3>
                                <div className="chart-meta-row">
                                  <p>출시 5일 전까지 예약주문 합: <strong>{preDecisionSum.toLocaleString()}</strong></p>
                                  <p>예약주문 수량 합: <strong>{preTotalSum.toLocaleString()}</strong></p>
                                  <span className="chart-legend-inline">실선: 일자별 예약주문 · 점선: 누적합</span>
                                </div>
                                <svg className="trend-line" viewBox="0 0 560 210" preserveAspectRatio="none">
                                  {chartGrid(560, 210, 24, `pre-${row.rowKey}`)}
                                  <path d={buildAreaPath(reservationPreCumulative, 560, 210, 24, unifiedBounds)} fill="#dcfce7" opacity="0.7" />
                                  <path d={buildLinePath(reservationPreCumulative, 560, 210, 24, unifiedBounds)} fill="none" stroke="#16a34a" strokeWidth="2" strokeDasharray="5 4" />
                                  <path d={buildLinePath(reservationPre, 560, 210, 24, unifiedBounds)} fill="none" stroke="#0c7a43" strokeWidth="3" />
                                      {reservationPre.map((p, idx) => {
                                    const { x, y } = pointXY(p, idx, reservationPre, 560, 210, 24, unifiedBounds)
                                    return (
                                      <g key={p.date}>
                                        <circle cx={x} cy={y} r="4.5" fill="#0c7a43" />
                                        <circle
                                          className="chart-hover-target"
                                          cx={x}
                                          cy={y}
                                          r="13"
                                          fill="transparent"
                                          onMouseEnter={(event) => showChartTooltip(event, [p.date, `일자별 예약주문 ${Number(p.qty || 0).toLocaleString()}EA`])}
                                          onMouseMove={moveChartTooltip}
                                          onMouseLeave={() => setChartTooltip(null)}
                                        />
                                        <text x={x} y={Math.max(14, y - 8)} textAnchor="middle" fontSize="10" fill="#14532d">
                                          {Number(p.qty).toLocaleString()}
                                        </text>
                                      </g>
                                    )
                                  })}
                                  {reservationPreCumulative.length > 0 && (() => {
                                    const lastIdx = reservationPreCumulative.length - 1
                                    const last = reservationPreCumulative[lastIdx]
                                    const { x, y } = pointXY(last, lastIdx, reservationPreCumulative, 560, 210, 24, unifiedBounds)
                                    return (
                                      <g>
                                        <circle
                                          className="chart-hover-target"
                                          cx={x}
                                          cy={y}
                                          r="13"
                                          fill="transparent"
                                          onMouseEnter={(event) => showChartTooltip(event, [last.date, `누적 예약주문 ${Number(last.qty || 0).toLocaleString()}EA`])}
                                          onMouseMove={moveChartTooltip}
                                          onMouseLeave={() => setChartTooltip(null)}
                                        />
                                        <text x={x - 6} y={Math.max(14, y - 10)} textAnchor="end" fontSize="10" fill="#166534">
                                          누적 {Number(last.qty).toLocaleString()}
                                        </text>
                                      </g>
                                    )
                                  })()}
                                  {reservationPre.map((p, idx) => {
                                    const { x } = pointXY(p, idx, reservationPre, 560, 210, 24, unifiedBounds)
                                    return (
                                      <text key={`x-pre-${p.date}`} x={x} y={206} textAnchor="middle" fontSize="10" fill="#64748b">
                                        {formatMd(p.date)}
                                      </text>
                                    )
                                  })}
                                </svg>
                                </div>
                                {postReleaseOutflow7d.length > 0 && (
                                  <div className="chart-block">
                                    <h3 className="subchart-title">출시 후 적정 출고 흐름</h3>
                                    <div className="chart-meta-row">
                                      <p>출시 후 센터 {horizonDays}일 출고 합: <strong>{postReleaseOutflow7d.reduce((s, p) => s + Number(p.qty || 0), 0).toLocaleString()}</strong></p>
                                      <p>출시 후 점포 4일 판매 누적: <strong>{storeSalesQty.toLocaleString()}</strong><small> · 소화율 {depletionRate.toFixed(1)}%</small></p>
                                      <span className="chart-legend-inline">파랑: 센터 출고 · 파랑 점선: 누적 출고 · 보라 점선: 누적 판매</span>
                                    </div>
                                    <svg className="trend-line" viewBox="0 0 560 210" preserveAspectRatio="none">
                                      {chartGrid(560, 210, 24, `post-${row.rowKey}`)}
                                      <path d={buildAreaPath(postReleaseOutflow7dCumulative, 560, 210, 24, unifiedBounds)} fill="#dbeafe" opacity="0.75" />
                                      <path d={buildLinePath(postReleaseOutflow7dCumulative, 560, 210, 24, unifiedBounds)} fill="none" stroke="#1d4ed8" strokeWidth="2" strokeDasharray="5 4" />
                                      <path d={buildLinePath(postReleaseOutflow7d, 560, 210, 24, unifiedBounds)} fill="none" stroke="#2563eb" strokeWidth="3" />
                                      {postReleaseStoreSales.length > 0 && (
                                        <>
                                          <path d={buildLinePath(postReleaseStoreSalesCumulative, 560, 210, 24, unifiedBounds)} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="3 5" />
                                        </>
                                      )}
                                      {postReleaseStoreSalesCumulative.map((p, idx) => {
                                        const { x, y } = pointXY(p, idx, postReleaseStoreSalesCumulative, 560, 210, 24, unifiedBounds)
                                        const outflowPoint = postReleaseOutflow7d[idx]
                                          ? pointXY(postReleaseOutflow7d[idx], idx, postReleaseOutflow7d, 560, 210, 24, unifiedBounds)
                                          : null
                                        const belowY = Math.min(190, y + 26)
                                        const aboveY = Math.max(14, y - 12)
                                        const belowCollidesWithOutflow = outflowPoint
                                          ? Math.abs(x - outflowPoint.x) < 34 && Math.abs(belowY - outflowPoint.y) < 34
                                          : false
                                        const labelY = y < 30 && !belowCollidesWithOutflow ? belowY : aboveY
                                        const label = Number(p.qty || 0).toLocaleString()
                                        return (
                                          <g key={`sale-cum-${p.date}`}>
                                            <circle
                                              cx={x}
                                              cy={y}
                                              r="3.5"
                                              fill="#7c3aed"
                                              stroke="#fff"
                                              strokeWidth="2"
                                              onMouseEnter={(event) => showChartTooltip(event, [p.date, `누적 점포 판매 ${label}EA`])}
                                              onMouseMove={moveChartTooltip}
                                              onMouseLeave={() => setChartTooltip(null)}
                                            />
                                            <text x={x} y={labelY} textAnchor="middle" fontSize="10" fontWeight="800" fill="#6d28d9" stroke="#f8fafc" strokeWidth="4" paintOrder="stroke">
                                              {label}
                                            </text>
                                          </g>
                                        )
                                      })}
                                      {postReleaseOutflow7d.map((p, idx) => {
                                        const { x, y } = pointXY(p, idx, postReleaseOutflow7d, 560, 210, 24, unifiedBounds)
                                        return (
                                          <g key={`post-${p.date}`}>
                                            <circle
                                              cx={x}
                                              cy={y}
                                              r="4"
                                              fill="#2563eb"
                                              onMouseEnter={(event) => showChartTooltip(event, [p.date, `센터 출고 ${Number(p.qty || 0).toLocaleString()}EA`])}
                                              onMouseMove={moveChartTooltip}
                                              onMouseLeave={() => setChartTooltip(null)}
                                            />
                                            <text x={x} y={Math.max(12, y - 8)} textAnchor="middle" fontSize="10" fontWeight="800" fill="#1e3a8a" stroke="#f8fafc" strokeWidth="4" paintOrder="stroke">
                                              {Number(p.qty).toLocaleString()}
                                            </text>
                                          </g>
                                        )
                                      })}
                                      {postReleaseOutflow7dCumulative.length > 0 && (() => {
                                        const lastIdx = postReleaseOutflow7dCumulative.length - 1
                                        const last = postReleaseOutflow7dCumulative[lastIdx]
                                        const { x, y } = pointXY(last, lastIdx, postReleaseOutflow7dCumulative, 560, 210, 24, unifiedBounds)
                                        return (
                                          <text
                                            x={x - 6}
                                            y={Math.max(14, y - 10)}
                                            textAnchor="end"
                                            fontSize="10"
                                            fill="#1e3a8a"
                                            onMouseEnter={(event) => showChartTooltip(event, [last.date, `누적 출고 ${Number(last.qty || 0).toLocaleString()}EA`])}
                                            onMouseMove={moveChartTooltip}
                                            onMouseLeave={() => setChartTooltip(null)}
                                          >
                                            누적 {Number(last.qty).toLocaleString()}
                                          </text>
                                        )
                                      })()}
                                      {postReleaseOutflow7d.map((p, idx) => {
                                        const { x } = pointXY(p, idx, postReleaseOutflow7d, 560, 210, 24, unifiedBounds)
                                        return (
                                          <text key={`x-post-${p.date}`} x={x} y={206} textAnchor="middle" fontSize="10" fill="#64748b">
                                            {formatMd(p.date)}
                                          </text>
                                        )
                                      })}
                                    </svg>
                                  </div>
                                )}
                              </>
                            ) : (
                              <p className="formula-note">예약주문 데이터가 없습니다.</p>
                            )}
                          </article>
                          <article className="viz-card center-map-card">
                            <h3>실제 센터 분배량 · 성과 맵</h3>
                            <div className="center-metric-legend">
                              <span><i className="legend-dot initial" />초도물량</span>
                              <span><i className="legend-dot outflow" />점포 출고</span>
                              <span><i className="legend-dot sales" />점포 판매</span>
                            </div>
                            {centerDist.length > 0 ? (
                              <div className="center-bars">
                                {centerDist.map((c) => (
                                  (() => {
                                    const rate = centerPerfMap[c.centerName] ?? 0
                                    const perf = centerPerfByName[c.centerName] || {}
                                    const initialQty = Number(c.qty || 0)
                                    const outflowQty = Number(perf.outflow7d || 0)
                                    const centerOutflowRate = Number(perf.outflowRate7d || 0)
                                    const centerSalesQty = Number(perf.storeSalesQty || 0)
                                    const centerSalesRate = Number(perf.salesDepletionRate || 0)
                                    const band = outflowBand(rate)
                                    const tone = band === 'over' ? 'high' : band === 'shortage' ? 'low' : 'ok'
                                    const statusLabel = band === 'over' ? '과발주' : band === 'shortage' ? '결품위험' : '정상발주'
                                    const initialWidth = Math.max(initialQty > 0 ? 3 : 0, Math.min(100, (initialQty / centerMax) * 100))
                                    const outflowWidth = Math.max(outflowQty > 0 ? 3 : 0, Math.min(100, (outflowQty / centerMax) * 100))
                                    const salesWidth = Math.max(centerSalesQty > 0 ? 3 : 0, Math.min(100, (centerSalesQty / centerMax) * 100))

                                    return (
                                      <div
                                        key={c.centerName}
                                        className={`center-row ${tone}`}
                                        data-tooltip={`초도 ${initialQty.toLocaleString()}개 / 출고 ${outflowQty.toLocaleString()}개(${centerOutflowRate.toFixed(1)}%) / 판매 ${centerSalesQty.toLocaleString()}개(${centerSalesRate.toFixed(1)}%)`}
                                      >
                                        <span>{c.centerName}</span>
                                        <div className="center-track-wrap">
                                          <div
                                            className="center-track quantity-stack"
                                            title={`초도 ${initialQty.toLocaleString()}개, 센터 출고 ${outflowQty.toLocaleString()}개, 점포 판매 ${centerSalesQty.toLocaleString()}개`}
                                          >
                                            <div className="center-fill frame" style={{ width: '100%' }} />
                                            <div className="center-fill initial" style={{ width: `${initialWidth}%` }} />
                                            <div className="center-fill outflow" style={{ width: `${outflowWidth}%` }} />
                                            <div className="center-fill sales" style={{ width: `${salesWidth}%` }} />
                                          </div>
                                          <small className={`center-status ${tone}`}>{statusLabel}</small>
                                        </div>
                                        <div className="center-edit">
                                          <strong>초도 {initialQty.toLocaleString()}개</strong>
                                          <small>출고 {outflowQty.toLocaleString()} · 판매 {centerSalesQty.toLocaleString()}</small>
                                        </div>
                                      </div>
                                    )
                                  })()
                                ))}
                              </div>
                            ) : (
                              <p className="formula-note">센터 분배 데이터가 없습니다.</p>
                            )}
                          </article>
                          <article className="viz-card">
                            <h3>ML 기반 예측 비교</h3>
                            <p className="ml-compare-note">
                              운영 추천량, 실제 초도, 보정 전 모델값을 박스 단위로 비교합니다. 정상 범주는 출시 후 실제 출고량 기준 1.0~1.4배입니다.
                            </p>
                            <div className="ml-compare-grid">
                              <div className="ml-headline">
                                <p className="ml-line">
                                  비교 상태:
                                  <span className={`kpi ${compareClass}`} style={{ marginLeft: 8 }}>{compareLabel}</span>
                                </p>
                                <p className="ml-line">
                                  정상 발주량 범주: <strong>{normalMinBox.toLocaleString()}박스 ~ {normalMaxBox.toLocaleString()}박스</strong>
                                  <span className="ml-subline">EA {normalMinEa.toLocaleString()} ~ {normalMaxEa.toLocaleString()}</span>
                                </p>
                                <p className="ml-line">
                                  현행 {fixedFormulaBox.toLocaleString()}박스 · 재산정 {recalFormulaBox.toLocaleString()}박스 · α {alphaRecommended ? alphaRecommended.toFixed(2) : '-'}
                                  <span className="ml-subline">EA {fixedFormulaEa.toLocaleString()} · {recalFormulaEa.toLocaleString()}</span>
                                </p>
                              </div>
                              <div className="ml-metrics-grid">
                                <div className="ml-metric-card">
                                  <small>운영 추천 초도</small>
                                  <strong>{mlBox.toLocaleString()}박스</strong>
                                  <span className="ml-subline">EA {mlEa.toLocaleString()}</span>
                                </div>
                                <div className="ml-metric-card">
                                  <small>보정 전 ML</small>
                                  <strong>{rawModelBox.toLocaleString()}박스</strong>
                                  <span className="ml-subline">EA {rawModelEa.toLocaleString()}</span>
                                </div>
                                <div className="ml-metric-card">
                                  <small>실제 초도</small>
                                  <strong>{actualBox.toLocaleString()}박스</strong>
                                  <span className="ml-subline">EA {actualEa.toLocaleString()}</span>
                                </div>
                                <div className="ml-metric-card">
                                  <small>편차</small>
                                  <strong>{mlGapBox >= 0 ? '+' : ''}{mlGapBox.toLocaleString()}박스</strong>
                                  <span className="ml-subline">EA {mlGapEa >= 0 ? '+' : ''}{mlGapEa.toLocaleString()} · {mlGapPct >= 0 ? '+' : ''}{mlGapPct}%</span>
                                </div>
                                <div className="ml-metric-card">
                                  <small>초도/적정</small>
                                  <strong>{adequacyRate}%</strong>
                                </div>
                              </div>
                            </div>
                          </article>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )})}
              </tbody>
            </table>
          </section>
          </>
        ) : activeTab === 'GNN' ? (
          <>
            <section className="gnn-brief">
              <div>
                <p>보조 모델 (1) GNN 기반 수요 네트워크</p>
                <strong>예약 점포가 실제 본발주 참여 점포로 확장되는 흐름을 상품·센터·점포군으로 확인합니다.</strong>
                <span>선 굵기는 예측 참여점포수, 센터 크기는 실제 본발주 참여점포수, 바깥 점포군은 참여 유형을 의미합니다.</span>
              </div>
              <div className="gnn-source">
                <small>데이터 기준</small>
                <strong>{gnnData?.totals?.items?.toLocaleString() || 0}개 상품 · {gnnData?.totals?.centers || 0}개 센터</strong>
              </div>
            </section>

            <section className="gnn-controls">
              <div className="past-filter-field search-field">
                <label>상품 검색</label>
                <input
                  type="text"
                  className="search"
                  placeholder="상품명/코드 검색"
                  value={gnnQuery}
                  onChange={(e) => setGnnQuery(e.target.value)}
                />
              </div>
              <div className="past-filter-field gnn-select-field">
                <label>네트워크 상품</label>
                <select
                  value={selectedGnnItem?.itemCode || ''}
                  onChange={(e) => {
                    setSelectedGnnItemCode(e.target.value)
                    setSelectedGnnCenterCode('')
                  }}
                >
                  {filteredGnnItems.map((item) => (
                    <option key={item.itemCode} value={item.itemCode}>
                      {item.itemCode} · {item.itemName}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {!selectedGnnItem ? (
              <section className="empty-note">수요 네트워크 데이터를 불러오지 못했습니다.</section>
            ) : (
              <>
                <section className="gnn-kpis">
                  <div className="gnn-kpi-card">
                    <small>예약 점포</small>
                    <strong>{Number(selectedGnnItem.summary.reservationStores || 0).toLocaleString()}</strong>
                    <span>출시 전 예약 참여</span>
                  </div>
                  <div className="gnn-kpi-card">
                    <small>실제 본발주 참여</small>
                    <strong>{Number(selectedGnnItem.summary.actualStores || 0).toLocaleString()}</strong>
                    <span>예약 외 참여 포함</span>
                  </div>
                  <div className="gnn-kpi-card">
                    <small>예측 참여</small>
                    <strong>{Number(selectedGnnItem.summary.predictedStores || 0).toLocaleString()}</strong>
                    <span>확장마진 포함</span>
                  </div>
                  <div className="gnn-kpi-card">
                    <small>예약 외 본발주</small>
                    <strong>{Number(selectedGnnItem.summary.nonReservedOrderStores || 0).toLocaleString()}</strong>
                    <span>전체의 {Number(selectedGnnItem.summary.nonReservedShare || 0).toFixed(1)}%</span>
                  </div>
                  <div className={`gnn-kpi-card ${selectedGnnItem.summary.predictionError > 0 ? 'high' : selectedGnnItem.summary.predictionError < 0 ? 'low' : 'ok'}`}>
                    <small>예측 오차</small>
                    <strong>{Number(selectedGnnItem.summary.predictionError || 0) >= 0 ? '+' : ''}{Number(selectedGnnItem.summary.predictionError || 0).toLocaleString()}</strong>
                    <span>예측/실제 {Math.round(Number(selectedGnnItem.summary.predictionRatio || 0) * 100)}%</span>
                  </div>
                </section>

                <section className="gnn-network-grid">
                  <article className="viz-card gnn-network-card">
                    <div className="gnn-card-head">
                      <div>
                        <h3>{selectedGnnItem.itemName}</h3>
                        <p>{selectedGnnItem.itemCode} · 카카오맵 기반 센터 수요 네트워크</p>
                      </div>
                      <div className="gnn-legend">
                        <span><i className="gnn-dot reserved" />예측 참여</span>
                        <span><i className="gnn-dot expanded" />실제 참여</span>
                        <span><i className="gnn-dot dropped" />예측 오차</span>
                      </div>
                    </div>
                    <KakaoDemandMap
                      item={selectedGnnItem}
                      selectedCenterCode={selectedGnnCenter?.centerCode || ''}
                      onSelect={(centerCode) => setSelectedGnnCenterCode(centerCode)}
                    />
                    {(() => {
                      const centers = selectedGnnItem.centers || []
                      const width = 980
                      const height = 620
                      const cx = width / 2
                      const cy = height / 2
                      const centerRadius = 200
                      const storeRadius = 280
                      const maxPred = Math.max(...centers.map((c) => Number(c.predictedStores || 0)), 1)
                      const maxActual = Math.max(...centers.map((c) => Number(c.actualStores || 0)), 1)
                      const positions = centers.map((center, idx) => {
                        const angle = -Math.PI / 2 + (idx / Math.max(centers.length, 1)) * Math.PI * 2
                        const x = cx + Math.cos(angle) * centerRadius
                        const y = cy + Math.sin(angle) * centerRadius
                        const sx = cx + Math.cos(angle) * storeRadius
                        const sy = cy + Math.sin(angle) * storeRadius
                        const px = -Math.sin(angle)
                        const py = Math.cos(angle)
                        return {
                          center,
                          angle,
                          x,
                          y,
                          groups: [
                            {
                              key: 'reserved',
                              label: '예약→본발주',
                              count: Number(center.reservedOrderStores || 0),
                              x: sx - px * 24,
                              y: sy - py * 24,
                            },
                            {
                              key: 'expanded',
                              label: '예약 없이 본발주',
                              count: Number(center.nonReservedOrderStores || 0),
                              x: sx,
                              y: sy,
                            },
                            {
                              key: 'dropped',
                              label: '예약 후 이탈',
                              count: Number(center.reservedDropStores || 0),
                              x: sx + px * 24,
                              y: sy + py * 24,
                            },
                          ],
                        }
                      })
                      return (
                        <svg className="gnn-network-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${selectedGnnItem.itemName} 수요 네트워크`}>
                          <defs>
                            <radialGradient id="productGlow" cx="50%" cy="50%" r="50%">
                              <stop offset="0%" stopColor="#dcfce7" />
                              <stop offset="100%" stopColor="#f8fafc" />
                            </radialGradient>
                          </defs>
                          {positions.map(({ center, x, y }) => {
                            const strokeWidth = 2 + (Number(center.predictedStores || 0) / maxPred) * 8
                            const tone = gnnTone(center)
                            return (
                              <path
                                key={`product-line-${center.centerCode}`}
                                className={`gnn-link ${tone}`}
                                d={`M ${cx} ${cy} Q ${(cx + x) / 2} ${(cy + y) / 2 - 18} ${x} ${y}`}
                                strokeWidth={strokeWidth}
                                onMouseEnter={(event) => showChartTooltip(event, [
                                  `${center.centerName}센터`,
                                  `예측 ${Number(center.predictedStores || 0).toLocaleString()}점포`,
                                  `실제 참여 ${Number(center.actualStores || 0).toLocaleString()}점포`,
                                ])}
                                onMouseMove={moveChartTooltip}
                                onMouseLeave={() => setChartTooltip(null)}
                              />
                            )
                          })}
                          {positions.flatMap(({ center, x, y, groups }) => groups.map((group) => (
                            <line
                              key={`store-line-${center.centerCode}-${group.key}`}
                              className={`gnn-store-link ${group.key}`}
                              x1={x}
                              y1={y}
                              x2={group.x}
                              y2={group.y}
                            />
                          )))}
                          <circle cx={cx} cy={cy} r="72" fill="url(#productGlow)" stroke="#86efac" strokeWidth="2" />
                          <text x={cx} y={cy - 10} textAnchor="middle" fontSize="16" fontWeight="900" fill="#0f172a">상품</text>
                          <text x={cx} y={cy + 13} textAnchor="middle" fontSize="12" fontWeight="800" fill="#64748b">{selectedGnnItem.itemCode}</text>
                          <text x={cx} y={cy + 34} textAnchor="middle" fontSize="12" fontWeight="800" fill="#0c7a43">{Number(selectedGnnItem.summary.actualStores || 0).toLocaleString()}점포 참여</text>

                          {positions.map(({ center, x, y }) => {
                            const r = 14 + (Number(center.actualStores || 0) / maxActual) * 22
                            const selected = selectedGnnCenter?.centerCode === center.centerCode
                            return (
                              <g
                                key={`center-node-${center.centerCode}`}
                                className={`gnn-center-node ${selected ? 'selected' : ''}`}
                                onClick={() => setSelectedGnnCenterCode(center.centerCode)}
                                onMouseEnter={(event) => showChartTooltip(event, [
                                  `${center.centerName}센터`,
                                  `${gnnToneLabel(center)} · 예측/실제 ${Math.round(Number(center.predictionRatio || 0) * 100)}%`,
                                  `예약 ${Number(center.reservationStores || 0).toLocaleString()} → 실제 ${Number(center.actualStores || 0).toLocaleString()}점포`,
                                ])}
                                onMouseMove={moveChartTooltip}
                                onMouseLeave={() => setChartTooltip(null)}
                              >
                                <circle cx={x} cy={y} r={r} />
                                <text x={x} y={y + 4} textAnchor="middle">{center.centerName}</text>
                                <text x={x} y={y + r + 16} textAnchor="middle" className="gnn-node-count">
                                  {Number(center.actualStores || 0).toLocaleString()}
                                </text>
                              </g>
                            )
                          })}
                          {positions.flatMap(({ center, groups }) => groups.map((group) => {
                            const radius = Math.max(5, Math.min(15, 5 + Math.sqrt(group.count || 0) / 2.4))
                            return (
                              <g
                                key={`group-node-${center.centerCode}-${group.key}`}
                                className={`gnn-store-node ${group.key}`}
                                onMouseEnter={(event) => showChartTooltip(event, [
                                  `${center.centerName}센터 · ${group.label}`,
                                  `${Number(group.count || 0).toLocaleString()}점포`,
                                  `샘플: ${(center.samples?.[group.key === 'reserved' ? 'reservedOrdered' : group.key === 'expanded' ? 'nonReservedOrdered' : 'reservedDropped'] || []).slice(0, 4).join(', ') || '-'}`,
                                ])}
                                onMouseMove={moveChartTooltip}
                                onMouseLeave={() => setChartTooltip(null)}
                              >
                                <circle cx={group.x} cy={group.y} r={radius} />
                                {group.count > 0 && (
                                  <text x={group.x} y={group.y - radius - 5} textAnchor="middle">
                                    {Number(group.count || 0).toLocaleString()}
                                  </text>
                                )}
                              </g>
                            )
                          }))}
                        </svg>
                      )
                    })()}
                  </article>

                  <aside className="viz-card gnn-detail-card">
                    <h3>선택 센터 상세</h3>
                    {selectedGnnCenter ? (
                      <>
                        <div className={`gnn-status ${gnnTone(selectedGnnCenter)}`}>
                          <strong>{selectedGnnCenter.centerName}센터</strong>
                          <span>{gnnToneLabel(selectedGnnCenter)}</span>
                        </div>
                        <div className="gnn-detail-metrics">
                          <div>
                            <small>예약 점포</small>
                            <strong>{Number(selectedGnnCenter.reservationStores || 0).toLocaleString()}</strong>
                          </div>
                          <div>
                            <small>실제 참여</small>
                            <strong>{Number(selectedGnnCenter.actualStores || 0).toLocaleString()}</strong>
                          </div>
                          <div>
                            <small>예측</small>
                            <strong>{Number(selectedGnnCenter.predictedStores || 0).toLocaleString()}</strong>
                          </div>
                          <div>
                            <small>예약 외 참여</small>
                            <strong>{Number(selectedGnnCenter.nonReservedOrderStores || 0).toLocaleString()}</strong>
                          </div>
                        </div>
                        <div className="gnn-flow-list">
                          <p><span>예약 후 본발주</span><strong>{Number(selectedGnnCenter.reservedOrderStores || 0).toLocaleString()}점포</strong></p>
                          <p><span>예약 없이 본발주</span><strong>{Number(selectedGnnCenter.nonReservedOrderStores || 0).toLocaleString()}점포</strong></p>
                          <p><span>예약 후 이탈</span><strong>{Number(selectedGnnCenter.reservedDropStores || 0).toLocaleString()}점포</strong></p>
                          <p><span>본발주 수량</span><strong>{Number(selectedGnnCenter.orderQty || 0).toLocaleString()}EA</strong></p>
                        </div>
                        <div className="gnn-samples">
                          <strong>대표 점포 코드</strong>
                          <p>예약→본발주: {(selectedGnnCenter.samples?.reservedOrdered || []).join(', ') || '-'}</p>
                          <p>예약 없이 본발주: {(selectedGnnCenter.samples?.nonReservedOrdered || []).join(', ') || '-'}</p>
                        </div>
                      </>
                    ) : (
                      <p className="formula-note">센터를 선택하면 상세가 표시됩니다.</p>
                    )}
                  </aside>
                </section>

                <section className="viz-card gnn-ranking-card">
                  <div className="gnn-card-head">
                    <div>
                      <h3>센터별 참여 확장 순위</h3>
                      <p>예약점포수에서 실제 본발주 참여점포수로 얼마나 확장됐는지 비교합니다.</p>
                    </div>
                  </div>
                  <div className="gnn-ranking-list">
                    {(selectedGnnItem.centers || []).slice(0, 15).map((center) => {
                      const maxActual = Math.max(...(selectedGnnItem.centers || []).map((c) => Number(c.actualStores || 0)), 1)
                      const width = Math.max(4, Math.min(100, (Number(center.actualStores || 0) / maxActual) * 100))
                      return (
                        <button
                          type="button"
                          key={`rank-${center.centerCode}`}
                          className={`gnn-rank-row ${selectedGnnCenter?.centerCode === center.centerCode ? 'selected' : ''}`}
                          onClick={() => setSelectedGnnCenterCode(center.centerCode)}
                        >
                          <span>{center.centerName}</span>
                          <div>
                            <i style={{ width: `${width}%` }} />
                          </div>
                          <strong>{Number(center.reservationStores || 0).toLocaleString()} → {Number(center.actualStores || 0).toLocaleString()}점포</strong>
                          <em>{Number(center.reservationToActualMultiplier || 0).toFixed(1)}배</em>
                        </button>
                      )
                    })}
                  </div>
                </section>
              </>
            )}
          </>
        ) : (
          <>
            <section className="lifecycle-brief">
              <div>
                <p>보조 모델 (2)</p>
                <strong>제품 생애주기 예측으로 출시 후 수요 흐름을 점검합니다.</strong>
                <span>전국 총량 → 센터 배분 → 주차별 판매 흐름으로 이어지는 모델 결과를 상품 단위로 확인합니다.</span>
              </div>
              <div className="lifecycle-source">
                <small>번들 기준</small>
                <strong>{Number(lifecycleData?.summary?.itemCount || 0).toLocaleString()}개 상품 · {Number(lifecycleData?.summary?.centerCount || 0).toLocaleString()}개 센터</strong>
              </div>
            </section>

            <section className="gnn-controls">
              <div className="past-filter-field search-field">
                <label>상품 검색</label>
                <input
                  type="text"
                  className="search"
                  placeholder="상품명/코드 검색"
                  value={lifecycleQuery}
                  onChange={(e) => setLifecycleQuery(e.target.value)}
                />
              </div>
              <div className="past-filter-field gnn-select-field">
                <label>생애주기 상품</label>
                <select
                  value={selectedLifecycleItem?.itemCode || ''}
                  onChange={(e) => setSelectedLifecycleItemCode(e.target.value)}
                >
                  {filteredLifecycleItems.map((item) => (
                    <option key={item.itemCode} value={item.itemCode}>
                      {item.itemCode} · {item.itemName}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {!selectedLifecycleItem ? (
              <section className="empty-note">제품 생애주기 데이터를 불러오지 못했습니다.</section>
            ) : (
              <>
                <section className="lifecycle-kpis">
                  <article>
                    <small>출시 전 예약 신호</small>
                    <strong>{Number(selectedLifecycleItem.d5QtySum || 0).toLocaleString()}EA</strong>
                    <span>D-5 의사결정 시점 입력 신호</span>
                  </article>
                  <article>
                    <small>예측 총 판매</small>
                    <strong>{Math.round(Number(selectedLifecycleItem.predictedTotal || 0)).toLocaleString()}EA</strong>
                    <span>{selectedLifecycleItem.targetWeekCount || 0}주 생애주기 예측</span>
                  </article>
                  <article>
                    <small>실제 총 판매</small>
                    <strong>{Math.round(Number(selectedLifecycleItem.actualTotal || 0)).toLocaleString()}EA</strong>
                    <span>검증 기간 실제값</span>
                  </article>
                  <article className={Number(selectedLifecycleItem.predictionRatio || 0) >= 1 ? 'high' : 'low'}>
                    <small>예측/실제</small>
                    <strong>{Math.round(Number(selectedLifecycleItem.predictionRatio || 0) * 100)}%</strong>
                    <span>오차 {Math.round(Number(selectedLifecycleItem.absoluteError || 0)).toLocaleString()}EA</span>
                  </article>
                </section>

                <section className="lifecycle-grid">
                  <article className="viz-card lifecycle-chart-card">
                    <div className="gnn-card-head">
                      <div>
                        <h3>{selectedLifecycleItem.itemName}</h3>
                        <p>{selectedLifecycleItem.itemCode} · 출시 {selectedLifecycleItem.launchDate} · {selectedLifecycleItem.targetWeekCount}주 흐름</p>
                      </div>
                      <div className="lifecycle-legend">
                        <span><i className="legend-dot predicted" />예측</span>
                        <span><i className="legend-dot actual" />실제</span>
                        <span><i className="legend-dot cumulative" />누적</span>
                      </div>
                    </div>
                    {(() => {
                      const weeks = selectedLifecycleItem.weekly || []
                      const predicted = weeks.map((w) => ({ date: `${w.weekIndex}주`, qty: Number(w.predicted || 0) }))
                      const actual = weeks.map((w) => ({ date: `${w.weekIndex}주`, qty: Number(w.actual || 0) }))
                      const predictedCum = weeks.map((w) => ({ date: `${w.weekIndex}주`, qty: Number(w.predictedCum || 0) }))
                      const actualCum = weeks.map((w) => ({ date: `${w.weekIndex}주`, qty: Number(w.actualCum || 0) }))
                      const bounds = {
                        min: 0,
                        max: Math.max(
                          ...predicted.map((p) => p.qty),
                          ...actual.map((p) => p.qty),
                          ...predictedCum.map((p) => p.qty),
                          ...actualCum.map((p) => p.qty),
                          1,
                        ),
                      }
                      return (
                        <svg className="lifecycle-chart" viewBox="0 0 760 360" role="img" aria-label={`${selectedLifecycleItem.itemName} 생애주기 예측과 실제`}>
                          {chartGrid(760, 360, 42, `life-${selectedLifecycleItem.itemCode}`)}
                          <path d={buildAreaPath(predictedCum, 760, 360, 42, bounds)} fill="#dbeafe" opacity="0.6" />
                          <path d={buildLinePath(predictedCum, 760, 360, 42, bounds)} fill="none" stroke="#2563eb" strokeWidth="2.4" strokeDasharray="7 6" />
                          <path d={buildLinePath(actualCum, 760, 360, 42, bounds)} fill="none" stroke="#0c7a43" strokeWidth="2.4" strokeDasharray="4 5" />
                          <path d={buildLinePath(predicted, 760, 360, 42, bounds)} fill="none" stroke="#60a5fa" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                          <path d={buildLinePath(actual, 760, 360, 42, bounds)} fill="none" stroke="#0c7a43" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                          {weeks.map((w, idx) => {
                            const predPoint = pointXY(predicted[idx], idx, predicted, 760, 360, 42, bounds)
                            const actPoint = pointXY(actual[idx], idx, actual, 760, 360, 42, bounds)
                            const x = predPoint.x
                            return (
                              <g key={`life-week-${w.weekIndex}`}>
                                <circle
                                  cx={predPoint.x}
                                  cy={predPoint.y}
                                  r="5"
                                  fill="#60a5fa"
                                  stroke="#fff"
                                  strokeWidth="2"
                                  onMouseEnter={(event) => showChartTooltip(event, [`${w.weekIndex}주차`, `예측 ${Math.round(Number(w.predicted || 0)).toLocaleString()}EA`, `예측 누적 ${Math.round(Number(w.predictedCum || 0)).toLocaleString()}EA`])}
                                  onMouseMove={moveChartTooltip}
                                  onMouseLeave={() => setChartTooltip(null)}
                                />
                                <circle
                                  cx={actPoint.x}
                                  cy={actPoint.y}
                                  r="5"
                                  fill="#0c7a43"
                                  stroke="#fff"
                                  strokeWidth="2"
                                  onMouseEnter={(event) => showChartTooltip(event, [`${w.weekIndex}주차`, `실제 ${Math.round(Number(w.actual || 0)).toLocaleString()}EA`, `실제 누적 ${Math.round(Number(w.actualCum || 0)).toLocaleString()}EA`])}
                                  onMouseMove={moveChartTooltip}
                                  onMouseLeave={() => setChartTooltip(null)}
                                />
                                <text x={x} y="340" textAnchor="middle" fontSize="12" fontWeight="800" fill="#64748b">
                                  {w.weekIndex}주
                                </text>
                              </g>
                            )
                          })}
                        </svg>
                      )
                    })()}
                  </article>

                  <article className="viz-card lifecycle-center-card">
                    <h3>센터별 생애주기 예측</h3>
                    <p className="lifecycle-card-note">센터별 예측 판매량과 실제 판매량 차이를 확인합니다.</p>
                    <div className="lifecycle-center-list">
                      {(selectedLifecycleItem.centers || []).slice(0, 12).map((center) => {
                        const maxCenter = Math.max(...(selectedLifecycleItem.centers || []).map((c) => Number(c.predictedSales || 0)), 1)
                        const predictedWidth = Math.max(3, Math.min(100, (Number(center.predictedSales || 0) / maxCenter) * 100))
                        const actualWidth = Math.max(3, Math.min(100, (Number(center.actualSales || 0) / maxCenter) * 100))
                        const tone = Number(center.predictionRatio || 0) > 1.15 ? 'high' : Number(center.predictionRatio || 0) < 0.85 ? 'low' : 'ok'
                        return (
                          <div className="lifecycle-center-row" key={`${selectedLifecycleItem.itemCode}-${center.centerCode}`}>
                            <span>{center.centerName}</span>
                            <div className="lifecycle-center-bars">
                              <i className="predicted" style={{ width: `${predictedWidth}%` }} />
                              <i className="actual" style={{ width: `${actualWidth}%` }} />
                            </div>
                            <strong className={tone}>{Math.round(Number(center.predictedSales || 0)).toLocaleString()}EA</strong>
                          </div>
                        )
                      })}
                    </div>
                  </article>
                </section>

                <section className="lifecycle-support-grid">
                  <article className="viz-card lifecycle-stage-card">
                    <h3>모델 단계별 성능</h3>
                    <div className="lifecycle-stage-list">
                      {(lifecycleData?.metrics || []).map((metric) => (
                        <div key={metric.stage}>
                          <span>{metric.label}</span>
                          <strong>WMAPE {(Number(metric.wmape || 0) * 100).toFixed(1)}%</strong>
                          <small>Bias {(Number(metric.bias || 0) * 100).toFixed(1)}% · {Number(metric.rows || 0).toLocaleString()}행</small>
                        </div>
                      ))}
                    </div>
                  </article>
                  <article className="viz-card lifecycle-feature-card">
                    <h3>추천량 산정 주요 피처</h3>
                    <div className="lifecycle-feature-list">
                      {(lifecycleData?.featureImportance || []).slice(0, 10).map((feature) => {
                        const maxImportance = Math.max(...(lifecycleData?.featureImportance || []).map((f) => Number(f.importance || 0)), 1)
                        return (
                          <div key={feature.feature}>
                            <span>{feature.feature}</span>
                            <i><b style={{ width: `${Math.max(3, Math.min(100, (Number(feature.importance || 0) / maxImportance) * 100))}%` }} /></i>
                            <strong>{Math.round(Number(feature.importance || 0)).toLocaleString()}</strong>
                          </div>
                        )
                      })}
                    </div>
                  </article>
                </section>
              </>
            )}
          </>
        )}
        {false && selectedTodayRow && data?.itemDetails?.[selectedTodayRow.rowKey] && (
          <div className="today-drawer-layer" onClick={() => setSelectedItemCode('')}>
            <aside
              className="today-drawer"
              aria-label={`${selectedTodayRow.itemName} 상세 검토 패널`}
              onClick={(event) => event.stopPropagation()}
            >
              {(() => {
                const r = selectedTodayRow
                const detail = data.itemDetails[r.rowKey] || {}
                const intro = predictedIntroInfo(r)
                const goalIntro = Number(r.goalIntroRate || 0)
                const introDelta = intro ? intro.rate - goalIntro : 0
                const ldu = boxUnitEa(r)
                const recommendedBox = mlRecommendBox(r)
                const inputBox = currentInputBox(r)
                const inputEa = Math.round(inputBox * ldu)
                const orderAmount = inputEa * Number(r.price || 0)
                const centers = centersForRow(r)
                const baseCenterBoxes = baseCenterBoxMap(r)
                const maxCenterBox = Math.max(...centers.map((c) => Number(c.qty || 0)), ...Object.values(baseCenterBoxes).map((x) => Number(x || 0)), 1)
                const dragMax = Math.ceil(maxCenterBox * 1.25)
                const productSummary = renderProductInfoSummary(r)
                const reservationTrend = renderDrawerReservationTrend(r)
                const drawerTabs = [
                  { key: 'summary', label: '요약', meta: '상품·수요·발주' },
                  { key: 'trend', label: '예약추세', meta: '일자별·누적' },
                  { key: 'center', label: '센터배분', meta: `${centers.length}개 센터` },
                  { key: 'review', label: '검토·유사상품', meta: 'AI·과거 사례' },
                ]
                return (
                  <>
                    <div className="today-drawer-head">
                      <div>
                        <div className="today-drawer-tags">
                          <span>{r.itemCode}</span>
                          <span>{r.category}</span>
                          <span className={outflowBand(currentOutflowRate(r)) === 'over' ? 'high' : outflowBand(currentOutflowRate(r)) === 'shortage' ? 'low' : 'ok'}>
                            {outflowBand(currentOutflowRate(r)) === 'over' ? '과발주' : outflowBand(currentOutflowRate(r)) === 'shortage' ? '결품위험' : '정상'}
                          </span>
                        </div>
                        <h2>{r.itemName}</h2>
                        <p>판매가 ₩{Number(r.price || 0).toLocaleString()} · 박스입수 {ldu.toLocaleString()}EA</p>
                      </div>
                      <button type="button" className="drawer-close" onClick={() => setSelectedItemCode('')} aria-label="상세 패널 닫기">×</button>
                    </div>

                    <nav className="drawer-detail-tabs" aria-label="상품 상세 검토 메뉴">
                      {drawerTabs.map((tab) => (
                        <button
                          type="button"
                          key={tab.key}
                          className={drawerDetailTab === tab.key ? 'active' : ''}
                          onClick={() => setDrawerDetailTab(tab.key)}
                        >
                          <strong>{tab.label}</strong>
                          <span>{tab.meta}</span>
                        </button>
                      ))}
                    </nav>

                    <div className="drawer-detail-body">
                      {drawerDetailTab === 'summary' && (
                        <>
                          {productSummary && (
                            <div className="drawer-section">
                              {productSummary}
                            </div>
                          )}

                          <div className="drawer-section">
                            <div className="drawer-section-title">수요 예측</div>
                            <div className="drawer-kpi-grid">
                              <article>
                                <small>목표 도입률</small>
                                <strong>{goalIntro.toFixed(1)}%</strong>
                              </article>
                              <article>
                                <small>예측(GNN)</small>
                                <strong>{intro ? `${intro.rate.toFixed(1)}%` : '-'}</strong>
                              </article>
                              <article className={introDelta >= 0 ? 'ok' : 'low'}>
                                <small>격차</small>
                                <strong>{intro ? `${introDelta >= 0 ? '+' : ''}${introDelta.toFixed(1)}%p` : '-'}</strong>
                              </article>
                            </div>
                            <div className="drawer-rate-compare">
                              <p>
                                <span>목표</span>
                                <i><b className="target" style={{ width: `${Math.min(100, goalIntro)}%` }} /></i>
                                <strong>{goalIntro.toFixed(1)}%</strong>
                              </p>
                              <p>
                                <span>예측</span>
                                <i><b className="predicted" style={{ width: `${Math.min(100, Number(intro?.rate || 0))}%` }} /></i>
                                <strong>{intro ? `${intro.rate.toFixed(1)}%` : '-'}</strong>
                              </p>
                            </div>
                          </div>

                          <div className="drawer-section">
                            <div className="drawer-section-title">발주 수량</div>
                            <div className="drawer-order-grid">
                              <article>
                                <small>권장 박스</small>
                                <strong>{recommendedBox.toLocaleString()}</strong>
                              </article>
                              <article>
                                <small>현재 입력</small>
                                <strong>{inputBox.toLocaleString()}</strong>
                              </article>
                              <article>
                                <small>EA 환산</small>
                                <strong>{inputEa.toLocaleString()} EA</strong>
                              </article>
                              <article>
                                <small>발주 금액</small>
                                <strong>₩{orderAmount.toLocaleString()}</strong>
                              </article>
                            </div>
                          </div>
                        </>
                      )}

                      {drawerDetailTab === 'trend' && (
                        <div className="drawer-section drawer-tab-single">
                          {reservationTrend || <p className="drawer-empty-note">예약주문 추세 데이터가 없습니다.</p>}
                        </div>
                      )}

                      {drawerDetailTab === 'center' && (
                        <div className="drawer-section drawer-tab-single">
                          <div className="drawer-section-head">
                            <div className="drawer-section-title">센터별 배분</div>
                            <small>{centers.length}개 센터 · 기준선을 누르면 권장값으로 복귀</small>
                          </div>
                          <div className="drawer-center-list">
                            {centers.map((c) => {
                              const tone = centerTone(r, c.centerName, c.qty)
                              const baseCenterBox = Number(baseCenterBoxes[c.centerName] || 0)
                              const fillWidth = Math.max(c.qty > 0 ? 3 : 0, Math.min(100, (Number(c.qty || 0) / dragMax) * 100))
                              const baseWidth = Math.max(baseCenterBox > 0 ? 3 : 0, Math.min(100, (baseCenterBox / dragMax) * 100))
                              return (
                                <div className="drawer-center-row" key={c.centerName}>
                                  <span>{c.centerName}</span>
                                  <div
                                    className="drawer-center-track"
                                    onPointerDown={(event) => {
                                      event.currentTarget.setPointerCapture?.(event.pointerId)
                                      updateCenterBoxFromPointer(event, r, centers, c.centerName, dragMax)
                                    }}
                                    onPointerMove={(event) => {
                                      if (event.buttons !== 1) return
                                      updateCenterBoxFromPointer(event, r, centers, c.centerName, dragMax)
                                    }}
                                    onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
                                  >
                                    <i className={tone} style={{ width: `${fillWidth}%` }} />
                                    <b
                                      style={{ left: `${baseWidth}%` }}
                                      title={`권장 ${baseCenterBox.toLocaleString()}박스`}
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        resetCenterToRecommended(r, centers, c.centerName)
                                      }}
                                    />
                                  </div>
                                  <strong>{Number(c.qty || 0).toLocaleString()}박스</strong>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {drawerDetailTab === 'review' && (
                        <>
                          <div className="drawer-section drawer-evidence-section">
                            {renderRecommendationEvidence(r)}
                            {renderDrawerAiReview(r)}
                          </div>

                          <div className="drawer-section drawer-similar-section">
                            {renderSimilarHistory(r, 4)}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="today-drawer-footer">
                      <button type="button" className="drawer-secondary" onClick={() => setSelectedItemCode('')}>닫기</button>
                      <button
                        type="button"
                        className="drawer-confirm"
                        onClick={() => {
                          setConfirmedMap((prev) => ({ ...prev, [r.rowKey]: true }))
                          setSelectedItemCode('')
                        }}
                      >
                        ✓ 발주 확정
                      </button>
                    </div>
                  </>
                )
              })()}
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
