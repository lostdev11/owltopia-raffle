/**
 * Unit checks for Pack Vault wheel math (no DOM).
 */
import assert from 'node:assert/strict'
import {
  PACK_VAULT_SLOT_COUNT,
  SELECTOR_ANGLE,
  anglePerPack,
  angularDistance,
  buildVaultPacks,
  formatPackIdLabel,
  nearestIndex,
  normalizeDegrees,
  packProximity,
  shortestDelta,
  shortestIndexDelta,
  slotAngle,
  snapRotation,
  wrapIndex,
} from '../lib/packs/vault-wheel'

const n = 24
assert.equal(anglePerPack(n), 15)
assert.equal(anglePerPack(30), 12)
assert.equal(PACK_VAULT_SLOT_COUNT, 24)

assert.equal(wrapIndex(-1, n), 23)
assert.equal(wrapIndex(24, n), 0)
assert.equal(wrapIndex(25, n), 1)

assert.equal(slotAngle(0, n), 0)
assert.equal(slotAngle(1, n), 15)
assert.equal(slotAngle(23, n), 345)

assert.equal(snapRotation(0, n), SELECTOR_ANGLE)
assert.equal(snapRotation(1, n), 165)
assert.equal(nearestIndex(snapRotation(0, n), n), 0)
assert.equal(nearestIndex(snapRotation(1, n), n), 1)
assert.equal(nearestIndex(snapRotation(23, n), n), 23)

// Half-step past pack 0 toward pack 1 selects pack 1
assert.equal(nearestIndex(SELECTOR_ANGLE - 8, n), 1)
// Other direction wraps to last pack
assert.equal(nearestIndex(SELECTOR_ANGLE + 8, n), 23)

assert.equal(normalizeDegrees(-165), 195)
assert.equal(shortestDelta(180, 165), -15)
assert.equal(shortestDelta(180, -165), 15)
assert.equal(shortestDelta(350, 10), 20)
assert.equal(angularDistance(10, 350), 20)

assert.equal(shortestIndexDelta(0, 1, n), 1)
assert.equal(shortestIndexDelta(0, 23, n), -1)
assert.equal(shortestIndexDelta(23, 0, n), 1)

const packs = buildVaultPacks(n)
assert.equal(packs.length, n)
assert.equal(packs[0]!.idLabel, '0001')
assert.equal(packs[23]!.idLabel, '0024')
assert.equal(formatPackIdLabel(0), '0001')

assert.ok(packProximity(snapRotation(0, n), 0, n) > 0.99)
assert.ok(packProximity(snapRotation(0, n), 1, n) < packProximity(snapRotation(0, n), 0, n))
assert.ok(packProximity(snapRotation(0, n), 12, n) < 0.15)

// Dynamic count — never assume 30
const n12 = 12
assert.equal(anglePerPack(n12), 30)
assert.equal(nearestIndex(snapRotation(5, n12), n12), 5)
assert.equal(buildVaultPacks(12).length, 12)

console.log('packs-vault-wheel: ok')
