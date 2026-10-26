import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('../public/data/', import.meta.url))
const allowed = ['dashboard-data.json', 'gnn-network.json', 'lifecycle-data.json'].sort()
assert.deepEqual(readdirSync(directory).sort(), allowed, 'Only approved generated fixtures may be public.')
for (const name of allowed) {
  assert.ok(statSync(directory + name).size < 1024 * 1024, 'Unexpected data volume: ' + name)
  const data = JSON.parse(readFileSync(directory + name, 'utf8'))
  assert.equal(data.provenance?.synthetic, true)
  const inspect = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'itemCode') assert.match(child, /^DEMO-SKU-\d{3}$/)
      if (key === 'centerCode') assert.match(child, /^DEMO-C\d{2}$/)
      if (typeof child === 'number') assert.ok(Number.isFinite(child))
      inspect(child)
    }
  }
  inspect(data)
}
const data = JSON.parse(readFileSync(directory + 'dashboard-data.json', 'utf8'))
assert.equal(data.weeklyRows.length, 4)
assert.equal(data.pastRows.length, 8)
for (const row of data.allRows) {
  const detail = data.itemDetails[row.rowKey]
  assert.equal(detail.reservation4d.length, 7)
  assert.equal(detail.centerDistribution.reduce((sum, c) => sum + c.qty, 0), row.recommendQty)
  const forward = detail.forwardPrediction
  assert.equal(forward.centers.reduce((sum, c) => sum + c.lifecycleDemandUpper, 0), forward.lifecycleDemandUpper)
  assert.equal(forward.centers.reduce((sum, c) => sum + c.predictedStores, 0), forward.predictedStores)
  assert.equal(forward.centers.reduce((sum, c) => sum + c.recommendedBox, 0), row.recommendQty / row.boxUnitEa)
  for (const center of forward.centers) {
    assert.ok(center.lifecycleDemandUpper > 0)
    assert.equal(center.recommendedBox * row.boxUnitEa, center.recommendedQty)
  }
}
console.log('Public fixture checks passed: synthetic identifiers, volume, coverage and allocation totals.')
