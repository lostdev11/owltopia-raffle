/**
 * Unit checks for buyer allowlist phase checkmarks (soft WL membership before/after open).
 *
 * Run: npx --yes tsx scripts/test-allowlist-phase-checks.ts
 */
import assert from 'node:assert/strict'

import { buildAllowlistPhaseChecks } from '../lib/owl-center/allowlist-phase-checks'
import type { PartnerAllowlistPhase } from '../lib/owl-center/partner-allowlist-phases'

const wl: PartnerAllowlistPhase = {
  key: 'wl',
  label: 'Whitelist',
  starts_at: '2026-09-27T10:30:00.000Z',
  supply: 888,
  price_usdc: 0,
  price_sol: null,
  wallet_mint_limit: 1,
}

const og: PartnerAllowlistPhase = {
  key: 'og',
  label: 'OG',
  starts_at: '2026-09-27T09:00:00.000Z',
  supply: 50,
  price_usdc: 0,
  price_sol: null,
  wallet_mint_limit: 2,
}

const fmt: PartnerAllowlistPhase = {
  key: 'fmt',
  label: 'Free Mint Token',
  starts_at: '2026-09-27T11:00:00.000Z',
  supply: 100,
  price_usdc: 0,
  price_sol: null,
  wallet_mint_limit: 1,
  redeem_token_mint: 'So11111111111111111111111111111111111111112',
  redeem_token_amount: 1,
  redeem_mode: 'burn',
}

{
  const rows = new Map([['wl', { allowed_mints: 1, used_mints: 0 }]])
  const checks = buildAllowlistPhaseChecks([wl, og], rows)
  assert.equal(checks.length, 2)
  assert.equal(checks[0]!.on_list, true)
  assert.equal(checks[0]!.allowed_mints, 1)
  assert.equal(checks[0]!.used_mints, 0)
  assert.equal(checks[1]!.on_list, false)
  assert.equal(checks[1]!.allowed_mints, null)
}

{
  const checks = buildAllowlistPhaseChecks([fmt], new Map())
  assert.equal(checks[0]!.on_list, null, 'FMT / holder-gated phases have no wallet paste list')
}

{
  const rows = new Map([
    ['wl', { allowed_mints: 1, used_mints: 0 }],
    ['og', { allowed_mints: 2, used_mints: 1 }],
  ])
  const checks = buildAllowlistPhaseChecks([wl, og], rows)
  assert.equal(checks.every((c) => c.on_list === true), true)
  assert.equal(checks.find((c) => c.key === 'og')!.used_mints, 1)
}

console.log('test-allowlist-phase-checks: ok')
