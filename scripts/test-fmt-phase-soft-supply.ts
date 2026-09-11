/**
 * Free Mint Token phase soft supply helpers.
 * recordLaunchPhaseMintUsage writes usage rows so sumLaunchWlPhaseUsedMints counts FMT mints
 * without requiring a pasted soft WL list; eligibility uses partnerPhaseSoftRemaining.
 * Run: npx --yes tsx scripts/test-fmt-phase-soft-supply.ts
 */
import assert from 'node:assert/strict'

import { partnerPhaseHasRedeemTokenBurn, partnerPhaseSoftRemaining, parsePartnerAllowlistPhases } from '../lib/owl-center/partner-allowlist-phases'
import { recordLaunchPhaseMintUsage, sumLaunchWlPhaseUsedMints } from '../lib/db/owl-center-launch-wl-wallets'

const FMT = 'So11111111111111111111111111111111111111112'
const phases = parsePartnerAllowlistPhases([
  {
    key: 'fmt',
    label: 'Free Mint Token',
    starts_at: '2026-09-01T12:00:00.000Z',
    supply: 1500,
    price_usdc: 0,
    redeem_token_mint: FMT,
    redeem_token_amount: 1,
    redeem_mode: 'burn',
  },
])
assert.equal(phases.length, 1)
assert.equal(partnerPhaseHasRedeemTokenBurn(phases[0]), true)
assert.equal(phases[0]!.supply, 1500)

// Soft remaining math (eligibility sold-out when remaining hits 0)
assert.equal(partnerPhaseSoftRemaining(phases[0]!.supply, 0), 1500)
assert.equal(partnerPhaseSoftRemaining(phases[0]!.supply, 1500), 0)

// Usage recorder is exported for confirm-mint burn branch (DB-backed; shape check only here)
assert.equal(typeof recordLaunchPhaseMintUsage, 'function')
assert.equal(typeof sumLaunchWlPhaseUsedMints, 'function')
assert.ok(recordLaunchPhaseMintUsage.length >= 3) // launchId, wallet, qty (+ optional phaseKey, allowedMints)

console.log('ok — fmt phase soft supply')
