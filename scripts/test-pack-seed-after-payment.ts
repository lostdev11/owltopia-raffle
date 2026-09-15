/**
 * Pack seed resolution after payment (VRF success vs local fallback).
 * Run: npx tsx scripts/test-pack-seed-after-payment.ts
 */
import assert from 'node:assert/strict'
import { resolvePackSeedFromVrfResult } from '../lib/packs/seed-after-payment'
import { PACK_OPEN_ALGO_V1, PACK_OPEN_ALGO_V2_VRF } from '../lib/packs/config'

function main() {
  const ok = resolvePackSeedFromVrfResult({
    vrfOk: true,
    vrfOpenSeed: 'aa'.repeat(32),
    localSeed: 'bb'.repeat(32),
  })
  assert.equal(ok.usedVrfFallback, false)
  assert.equal(ok.algo, PACK_OPEN_ALGO_V2_VRF)
  assert.equal(ok.seed, 'aa'.repeat(32))

  const fallback = resolvePackSeedFromVrfResult({
    vrfOk: false,
    vrfError: 'InvalidSecpSignature 6016',
    localSeed: 'cc'.repeat(32),
  })
  assert.equal(fallback.usedVrfFallback, true)
  assert.equal(fallback.algo, PACK_OPEN_ALGO_V1)
  assert.equal(fallback.seed, 'cc'.repeat(32))
  assert.match(fallback.vrfError, /InvalidSecpSignature/)

  // Missing seed even when ok → treat as fallback (defensive).
  const missing = resolvePackSeedFromVrfResult({
    vrfOk: true,
    localSeed: 'dd'.repeat(32),
  })
  assert.equal(missing.usedVrfFallback, true)
  assert.equal(missing.algo, PACK_OPEN_ALGO_V1)

  console.log(JSON.stringify({ ok: true, fallbackAlgo: fallback.algo }, null, 2))
}

main()
