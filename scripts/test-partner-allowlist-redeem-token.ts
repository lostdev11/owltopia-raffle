/**
 * Partner allowlist Free Mint Token (redeem_token_*) parse + helpers.
 * Run: npx --yes tsx scripts/test-partner-allowlist-redeem-token.ts
 */
import assert from 'node:assert/strict'

import {
  formRowsFromPartnerAllowlistPhases,
  partnerAllowlistPhasesFromFormRows,
  partnerPhaseHasRedeemTokenBurn,
  partnerPhaseRedeemTokenAmount,
  parsePartnerAllowlistPhases,
} from '../lib/owl-center/partner-allowlist-phases'

const FMT = 'So11111111111111111111111111111111111111112'

const parsed = parsePartnerAllowlistPhases([
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
  {
    key: 'wl',
    label: 'Whitelist',
    starts_at: '2026-09-01T14:00:00.000Z',
    supply: 500,
    price_usdc: 9,
  },
])

assert.equal(parsed.length, 2)
assert.equal(partnerPhaseHasRedeemTokenBurn(parsed[0]), true)
assert.equal(partnerPhaseRedeemTokenAmount(parsed[0]), 1)
assert.equal(parsed[0]!.redeem_token_mint, FMT)
assert.equal(partnerPhaseHasRedeemTokenBurn(parsed[1]), false)
assert.equal(partnerPhaseRedeemTokenAmount(parsed[1]), 0)

const rows = formRowsFromPartnerAllowlistPhases(parsed, (iso) => iso)
assert.equal(rows[0]!.redeem_token_mint, FMT)
assert.equal(rows[0]!.redeem_token_amount, '1')

const roundTrip = partnerAllowlistPhasesFromFormRows(rows, (local) => local)
if ('error' in roundTrip) throw new Error(roundTrip.error)
assert.equal(roundTrip[0]!.redeem_token_mint, FMT)
assert.equal(roundTrip[0]!.redeem_mode, 'burn')
assert.equal(roundTrip[0]!.redeem_token_amount, 1)

const noBurn = parsePartnerAllowlistPhases([
  {
    key: 'fmt',
    label: 'Free Mint Token',
    starts_at: '2026-09-01T12:00:00.000Z',
    supply: 10,
    price_usdc: 0,
    redeem_token_mint: 'short',
  },
])
assert.equal(partnerPhaseHasRedeemTokenBurn(noBurn[0]), false)

console.log('ok — partner allowlist redeem token')
