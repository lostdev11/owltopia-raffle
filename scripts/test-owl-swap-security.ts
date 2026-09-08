/**
 * Unit tests for OwlSwap deposit/access/simulate security helpers.
 * Run: npx tsx scripts/test-owl-swap-security.ts
 */
import assert from 'node:assert/strict'
import {
  isOwlSwapSimulateEnabled,
  isOwlSwapSimulateSignature,
  makeOwlSwapSimulateSignature,
} from '@/lib/owl-swap/simulate'
import { isOwlSwapPublic } from '@/lib/owl-swap/access'
import { verifyOwlSwapMintForAllowlist } from '@/lib/owl-swap/allowlist'
import { OWL_SWAP_MAX_SOL_SWEETENER_LAMPORTS } from '@/lib/owl-swap/constants'

const saved: Record<string, string | undefined> = {
  OWL_SWAP_PUBLIC: process.env.OWL_SWAP_PUBLIC,
  NEXT_PUBLIC_OWL_SWAP_PUBLIC: process.env.NEXT_PUBLIC_OWL_SWAP_PUBLIC,
  OWL_SWAP_SIMULATE: process.env.OWL_SWAP_SIMULATE,
  NEXT_PUBLIC_OWL_SWAP_SIMULATE: process.env.NEXT_PUBLIC_OWL_SWAP_SIMULATE,
  OWL_SWAP_SIMULATE_WITH_ESCROW: process.env.OWL_SWAP_SIMULATE_WITH_ESCROW,
  OWL_SWAP_ESCROW_SECRET_KEY: process.env.OWL_SWAP_ESCROW_SECRET_KEY,
  OWL_SWAP_ALLOWED_COLLECTIONS: process.env.OWL_SWAP_ALLOWED_COLLECTIONS,
  OWL_SWAP_ALLOW_ANY_MINT: process.env.OWL_SWAP_ALLOW_ANY_MINT,
}

function restore() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

try {
  // Server public flag ignores NEXT_PUBLIC alone
  delete process.env.OWL_SWAP_PUBLIC
  process.env.NEXT_PUBLIC_OWL_SWAP_PUBLIC = 'true'
  assert.equal(isOwlSwapPublic(), false)

  process.env.OWL_SWAP_PUBLIC = 'true'
  assert.equal(isOwlSwapPublic(), true)

  // Simulate never when public
  delete process.env.OWL_SWAP_ESCROW_SECRET_KEY
  process.env.OWL_SWAP_SIMULATE = 'true'
  assert.equal(isOwlSwapSimulateEnabled(), false)

  delete process.env.OWL_SWAP_PUBLIC
  delete process.env.NEXT_PUBLIC_OWL_SWAP_PUBLIC
  delete process.env.OWL_SWAP_SIMULATE
  delete process.env.OWL_SWAP_SIMULATE_WITH_ESCROW
  delete process.env.OWL_SWAP_ESCROW_SECRET_KEY
  assert.equal(isOwlSwapSimulateEnabled(), true)

  // Escrow key present → sim off even if OWL_SWAP_SIMULATE=true
  process.env.OWL_SWAP_ESCROW_SECRET_KEY = 'dummy'
  process.env.OWL_SWAP_SIMULATE = 'true'
  assert.equal(isOwlSwapSimulateEnabled(), false)

  process.env.OWL_SWAP_SIMULATE_WITH_ESCROW = 'true'
  assert.equal(isOwlSwapSimulateEnabled(), true)

  assert.ok(isOwlSwapSimulateSignature(makeOwlSwapSimulateSignature('settle', 'abcd')))
  assert.equal(isOwlSwapSimulateSignature('realSig'), false)

  // Public + empty allowlist blocked
  process.env.OWL_SWAP_PUBLIC = 'true'
  delete process.env.OWL_SWAP_ALLOWED_COLLECTIONS
  delete process.env.OWL_SWAP_ALLOW_ANY_MINT
  assert.equal(verifyOwlSwapMintForAllowlist({ mint: 'x' }).verified, false)

  process.env.OWL_SWAP_ALLOW_ANY_MINT = 'true'
  assert.equal(verifyOwlSwapMintForAllowlist({ mint: 'x' }).verified, true)

  delete process.env.OWL_SWAP_PUBLIC
  delete process.env.OWL_SWAP_ALLOW_ANY_MINT
  assert.equal(verifyOwlSwapMintForAllowlist({ mint: 'x' }).verified, true)

  process.env.OWL_SWAP_ALLOWED_COLLECTIONS = 'Owltopia'
  assert.equal(
    verifyOwlSwapMintForAllowlist({ mint: 'x', collection: null }).verified,
    false
  )
  assert.equal(
    verifyOwlSwapMintForAllowlist({ mint: 'x', collection: 'Owltopia' }).verified,
    true
  )

  assert.ok(OWL_SWAP_MAX_SOL_SWEETENER_LAMPORTS >= 1_000_000_000)
} finally {
  restore()
}

console.log('ok — owl-swap security helpers')
