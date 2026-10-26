// Deterministic, fictional fixtures. This script never reads business data.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../public/data/', import.meta.url))
mkdirSync(out, { recursive: true })
const provenance = {
  synthetic: true,
  source: 'Generated examples; no original records or fitted predictions.',
  generator: 'scripts/generate-demo-data.mjs',
  version: 1,
}
const centers = [
  ['DEMO-C01', '데모 수도권 센터', 0.32],
  ['DEMO-C02', '데모 영남 센터', 0.26],
  ['DEMO-C03', '데모 충청 센터', 0.22],
  ['DEMO-C04', '데모 호남 센터', 0.14],
  ['DEMO-C05', '데모 제주 센터', 0.06],
]
const names = ['코코아 크런치', '통밀 비스킷', '허브 포테이토', '베리 웨이퍼',
  '고소한 라이스칩', '시나몬 쿠키', '바닐라 샌드', '솔티 크래커',
  '메이플 팝콘', '오트 바이트', '흑임자 쿠키', '허니 스틱']
const iso = (value) => new Date(value).toISOString().slice(0, 10)
const day = (date, delta) => iso(Date.parse(date) + delta * 86400000)
const round = (n) => Math.round(n)
const write = (name, value) => writeFileSync(out + name, JSON.stringify({ provenance, ...value }, null, 2) + '\n')
const split = (total) => {
  let assigned = 0
  return centers.map(([, , share], i) => {
    const quantity = i === centers.length - 1 ? total - assigned : round(total * share)
    assigned += quantity
    return quantity
  })
}

const allRows = []
const itemDetails = {}
const networkItems = []
const lifecycleItems = []

names.forEach((name, i) => {
  const current = i < 4
  const itemCode = 'DEMO-SKU-' + String(i + 1).padStart(3, '0')
  const releaseDate = current ? '2025-12-31' : day('2025-12-15', -(i - 4) * 9)
  const deadlineDate = day(releaseDate, -5)
  const rowKey = itemCode + '_' + releaseDate
  const ldu = [12, 16, 20, 24][i % 4]
  const reservation = Array.from({ length: 7 }, (_, d) => ({
    date: day(deadlineDate, d - 6),
    qty: 280 + i * 43 + [120, 170, 210, 310, 390, 430, 520][d] + (i % 3) * d * 18,
  }))
  const anchor = reservation.reduce((sum, p) => sum + p.qty, 0)
  const modelQty = round(anchor * (1.75 + (i % 3) * 0.13) / ldu) * ldu
  const recommended = round(modelQty * 1.15 / ldu) * ldu
  const actualOutflow = round(modelQty * (0.82 + (i % 5) * 0.08))
  const actualOrder = round(actualOutflow * (0.85 + (i % 4) * 0.19) / ldu) * ldu
  const salesQty = round(actualOutflow * 0.79)
  const price = 1500 + (i % 5) * 300
  const rate = round(actualOrder / actualOutflow * 1000) / 10
  const row = {
    rowKey, itemCode, itemName: '데모 ' + name,
    category: '과자', categoryMid: ['스낵', '비스킷', '스낵', '비스킷'][i % 4],
    categorySub: ['초코', '통밀', '감자', '웨이퍼'][i % 4],
    releaseDate, deadlineDate, decisionDate: deadlineDate,
    boxUnitEa: ldu, lduEa: ldu, minOrdQty: ldu, price,
    recommendQty: recommended, mlRecommendQty: recommended, modelQty,
    formulaFixedQty: round(anchor * 2.5), formulaRecalQty: round(anchor * 2),
    formulaQtyFromModelTable: round(anchor * 2.5),
    calibratedQtyAuto: recommended, calibratedQtyReco: recommended,
    reservationAnchorQty: anchor, goalIntroRate: 60 + i % 4 * 5,
    predictedOutflow7d: modelQty, actualOutflow4dFromModel: actualOutflow,
    modelSource: 'synthetic-demo', modelAlphaRecommended: 1.15,
    inputQty: recommended, actualInitialQty: actualOrder,
    actualOutflow7d: actualOutflow, appropriateOutflowQty: actualOutflow,
    actualOutflowRate7d: round(actualOutflow / actualOrder * 1000) / 10,
    orderAdequacyRate: rate, salesRate: rate,
    actualStoreSalesQty: salesQty, actualStoreSalesAmount: salesQty * price,
    salesDepletionRate: round(salesQty / actualOrder * 1000) / 10,
    storeSalesToOutflowRate: 79, outflowHorizonDays: 4, salesDepletionHorizonDays: 30,
    actualDataReason: '화면 동작 확인용 합성 수치',
  }
  allRows.push(row)
  const allocations = split(recommended)
  const distributions = centers.map(([centerCode, centerName, share], j) => ({
    centerCode, centerName, qty: allocations[j], initialQty: allocations[j],
    reserveQty: round(anchor * share), reserveShare: share,
    storeCount: round(1200 * share), storeShare: share,
    centerWeight: 1, allocationIndex: share, weight: 1,
  }))
  const forwardCenters = distributions.map((c) => ({
    ...c, recommendedQty: c.qty, recommendedBox: round(c.qty / ldu),
    reservationQty: c.reserveQty, predictedStores: round(c.storeCount * 0.72),
  }))
  itemDetails[rowKey] = {
    reservation4d: reservation, reservationPreRelease: reservation,
    reservationPre4dSum: reservation.slice(0, 4).reduce((sum, p) => sum + p.qty, 0),
    reservationPreTotalSum: anchor,
    centerDistribution: distributions,
    centerPerformance7d: distributions.map((c) => ({
      ...c, outflowQty7d: round(actualOutflow * c.storeShare),
      outflowRate7d: 88 + i * 2, storeSalesQty: round(salesQty * c.storeShare),
      salesDepletionRate: 76,
    })),
    postReleaseOutflow7d: Array.from({ length: 4 }, (_, d) => ({
      date: day(releaseDate, d), qty: round(actualOutflow * [0.3, 0.28, 0.24, 0.18][d]),
    })),
    postReleaseStoreSales: Array.from({ length: 14 }, (_, d) => ({
      date: day(releaseDate, d), qty: round(salesQty / 14 * (1.3 - d / 22)),
    })),
    postReleaseStoreSalesQty: salesQty, postReleaseStoreSalesAmount: salesQty * price,
    centerInitialQtySum: actualOrder, centerOutflow7dSum: actualOutflow,
    outflowHorizonDays: 4, salesDepletionHorizonDays: 30,
    salesDepletionRate: row.salesDepletionRate, storeSalesToOutflowRate: 79,
    formula: { totalRecommendQty: recommended, modelQty, formulaFixedQty: row.formulaFixedQty,
      formulaRecalQty: row.formulaRecalQty, calibratedQtyReco: recommended,
      reservationAnchorQty: anchor, alphaRecommended: 1.15, modelSource: 'synthetic-demo',
      rule: '설명용 예시: 합성 예약 신호 × 예시 배수 × 운영 보정' },
    productInfo: { capacity: '100g', descriptionPoints: ['포트폴리오 화면 확인을 위한 가상 상품입니다.',
      '발주량과 판매량은 실제 기업 자료와 무관한 예시입니다.'], profitRate: 25,
      displayLocation: '데모 진열대', orderStartDate: day(deadlineDate, -6),
      eventNote: '합성 데이터 · 실제 모델 성능을 나타내지 않습니다.' },
    forwardPrediction: { itemCode, itemName: row.itemName, reservationQty: anchor,
      recommendedQty: recommended, recommendedBox: round(recommended / ldu),
      predictedStores: 864, lifecycleDemandUpper: round(recommended * 1.6),
      centerCount: 5, centers: forwardCenters, source: 'synthetic-demo' },
    recommendationEvidence: { reservationDecisionSum: anchor, reservationInitial4Sum: round(anchor * 0.48),
      frontloadRatio: 48, similarAvgOrderQty: round(recommended * 0.93), similarAvgAdequacyRate: 117,
      modelRule: '합성 데이터 예시', mdInterpretation: ['예약 흐름과 센터별 배분을 함께 검토합니다.'] },
    similarProducts: [],
  }
  const summary = { reservationStores: 650 + i * 20, actualStores: 800 + i * 15,
    predictedStores: 850 + i * 12, rawPredictedStores: 850 + i * 12,
    reservedOrderStores: 600, reservedDropStores: 50, nonReservedOrderStores: 200,
    reservationQty: anchor, orderQty: recommended, expansionMargin: 150,
    predictionError: 50, predictionRatio: 1.05, nonReservedShare: 25 }
  networkItems.push({ itemCode, itemName: row.itemName, summary,
    centers: distributions.map((c) => ({ ...c, actualStores: round(800 * c.storeShare),
      predictedStores: round(850 * c.storeShare), reservationStores: round(650 * c.storeShare),
      orderQty: c.qty, reservationQty: c.reserveQty, samples: {} })) })
  let predictedCum = 0
  let actualCum = 0
  const weekly = Array.from({ length: 8 }, (_, w) => {
    const predicted = round(modelQty * (0.32 - w * 0.03))
    const actual = round(predicted * (0.9 + (w % 3) * 0.08))
    predictedCum += predicted; actualCum += actual
    return { weekIndex: w + 1, predicted, actual, predictedCum, actualCum }
  })
  lifecycleItems.push({ itemCode, itemName: row.itemName, launchDate: releaseDate,
    d5QtySum: anchor, targetWeekCount: 8, predictedTotal: predictedCum, actualTotal: actualCum,
    predictionRatio: predictedCum / actualCum, absoluteError: Math.abs(predictedCum - actualCum),
    weekly, centers: distributions.map((c) => ({ ...c,
      predictedSales: round(predictedCum * c.storeShare), actualSales: round(actualCum * c.storeShare) })) })
})

for (const row of allRows) {
  itemDetails[row.rowKey].similarProducts = allRows.filter((r) => r.rowKey !== row.rowKey && r.deadlineDate < '2025-12-26')
    .slice(0, 4).map((r) => ({ ...r, actualOrderQty: r.actualInitialQty,
      adequacyRate: r.orderAdequacyRate, outflowQty: r.actualOutflow7d,
      score: 0.8, trendSimilarity: 0.8, reason: '합성 예약 패턴 예시' }))
}
const weeklyRows = allRows.slice(0, 4)
const pastRows = allRows.slice(4).map((r) => ({ ...r, actualOrderQty: r.actualInitialQty,
  outflowRate: r.actualOutflowRate7d, actualOutflowRate: r.actualOutflowRate7d }))
write('dashboard-data.json', {
  generatedAt: '2026-10-26T00:00:00Z', decisionDate: '2025-12-26', latestReleaseDate: '2025-12-31',
  releaseDates: [...new Set(allRows.map((r) => r.releaseDate))].sort().reverse(),
  categories: ['전체', '과자'], categoriesMid: ['전체', '스낵', '비스킷'],
  categoriesSub: ['전체', '초코', '통밀', '감자', '웨이퍼'],
  kpis: { newItemCount: 4, totalRecommendQty: weeklyRows.reduce((sum, r) => sum + r.recommendQty, 0),
    avgSalesRate: 115, riskItemCount: 1 },
  dataSources: { demo: 'scripts/generate-demo-data.mjs' }, allRows, weeklyRows, pastRows, itemDetails,
})
write('gnn-network.json', {
  generatedAt: '2026-10-26T00:00:00Z', sourceFiles: { demo: 'scripts/generate-demo-data.mjs' },
  totals: { items: 12, centers: 5, reservationStores: 9000, actualStores: 10600,
    predictedStores: 10800, reservedOrderStores: 7200, nonReservedOrderStores: 2400,
    reservedDropStores: 600, orderQty: allRows.reduce((sum, r) => sum + r.recommendQty, 0) },
  items: networkItems,
})
write('lifecycle-data.json', {
  generatedAt: '2026-10-26T00:00:00Z', summary: { itemCount: 12, centerCount: 5 },
  items: lifecycleItems, metrics: [], featureImportance: [],
})
console.log('Generated 12 fictional products and 5 demo centers. No input files read.')
