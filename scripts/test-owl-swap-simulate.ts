/**
 * Unit tests for OwlSwap simulation mode helpers.
 * Run: npx tsx scripts/test-owl-swap-simulate.ts
 */
import assert from 'node:assert/strict'
import {
  isOwlSwapSimulateEnabled,
  isOwlSwapSimulateSignature,
  makeOwlSwapSimulateSignature,
} from '@/lib/owl-swap/simulate'

assert.equal(isOwlSwapSimulateSignature(null), false)
assert.equal(isOwlSwapSimulateSignature(''), false)
assert.equal(isOwlSwapSimulateSignature('5xyzabc'), false)
assert.equal(isOwlSwapSimulateSignature('sim:maker-deposit:abcd1234:xyz'), true)

const sig = makeOwlSwapSimulateSignature('maker-deposit', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
assert.ok(sig.startsWith('sim:maker-deposit:aaaaaaaa:'))
assert.equal(isOwlSwapSimulateSignature(sig), true)

const settle = makeOwlSwapSimulateSignature('settle', 'ffffffff-0000-1111-2222-333333333333')
assert.ok(settle.startsWith('sim:settle:ffffffff:'))

// Env matrix for isOwlSwapSimulateEnabled (never when public).
const saved = {
  OWL_SWAP_PUBLIC: process.env.OWL_SWAP_PUBLIC,
  NEXT_PUBLIC_OWL_SWAP_PUBLIC: process.env.NEXT_PUBLIC_OWL_SWAP_PUBLIC,
  OWL_SWAP_SIMULATE: process.env.OWL_SWAP_SIMULATE,
  NEXT_PUBLIC_OWL_SWAP_SIMULATE: process.env.NEXT_PUBLIC_OWL_SWAP_SIMULATE,
  OWL_SWAP_ESCROW_SECRET_KEY: process.env.OWL_SWAP_ESCROW_SECRET_KEY,
}

function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

try {
  delete process.env.OWL_SWAP_PUBLIC
  delete process.env.NEXT_PUBLIC_OWL_SWAP_PUBLIC
  delete process.env.OWL_SWAP_SIMULATE
  delete process.env.NEXT_PUBLIC_OWL_SWAP_SIMULATE
  delete process.env.OWL_SWAP_ESCROW_SECRET_KEY

  // Admin-only + no escrow → auto simulate
  assert.equal(isOwlSwapSimulateEnabled(), true)

  process.env.OWL_SWAP_SIMULATE = 'false'
  assert.equal(isOwlSwapSimulateEnabled(), false)

  process.env.OWL_SWAP_SIMULATE = 'true'
  assert.equal(isOwlSwapSimulateEnabled(), true)

  // Public launch never simulates
  process.env.OWL_SWAP_PUBLIC = 'true'
  assert.equal(isOwlSwapSimulateEnabled(), false)

  delete process.env.OWL_SWAP_PUBLIC
  process.env.OWL_SWAP_SIMULATE = 'true'
  // With escrow key present, explicit true alone does NOT enable simulate
  process.env.OWL_SWAP_ESCROW_SECRET_KEY =
    '1111111111111111111111111111111111111111111111111111111111111111'
  delete process.env.OWL_SWAP_SIMULATE_WITH_ESCROW
  assert.equal(isOwlSwapSimulateEnabled(), false)

  process.env.OWL_SWAP_SIMULATE_WITH_ESCROW = 'true'
  assert.equal(isOwlSwapSimulateEnabled(), true)
} finally {
  restoreEnv()
}

console.log('ok — owl-swap simulate helpers')
