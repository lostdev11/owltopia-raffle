/**
 * Partner mint phase schedule + live unit price helpers.
 * Run: npx tsx scripts/test-partner-mint-phase-schedule.ts
 */
import assert from 'node:assert/strict'

import {
  buildPartnerMintPhaseSchedule,
  formatPartnerMintConsolePriceBits,
  formatPartnerPhasePriceUsdc,
  partnerAllowlistPhaseEndsAt,
  publicSimpleSettlementLabel,
  publicSimpleSolMintPrice,
  resolvePartnerMintConsolePhase,
  resolvePartnerMintUnitPrice,
} from '../lib/owl-center/partner-mint-phase-schedule'
import type { OwlCenterLaunchPublic } from '../lib/owl-center/types'

const past = '2026-08-18T12:00:00.000Z'
const mid = '2026-08-19T12:00:00.000Z'
const future = '2026-08-24T12:00:00.000Z'
const later = '2026-08-26T12:00:00.000Z'
const now = Date.parse('2026-08-20T12:00:00.000Z')

function launch(
  overrides: Partial<
    Pick<
      OwlCenterLaunchPublic,
      | 'partner_allowlist_phases'
      | 'creator_wl_enabled'
      | 'wl_supply'
      | 'wl_price_usdc'
      | 'phase_schedule'
      | 'public_supply'
      | 'public_price_usdc'
      | 'wallet_mint_limit'
      | 'presale_supply'
      | 'creator_presale_enabled'
      | 'active_phase'
      | 'is_paused'
      | 'creator_mint_price'
      | 'creator_mint_currency'
    >
  > = {}
): Pick<
  OwlCenterLaunchPublic,
  | 'partner_allowlist_phases'
  | 'creator_wl_enabled'
  | 'wl_supply'
  | 'wl_price_usdc'
  | 'phase_schedule'
  | 'launch_deadline_at'
  | 'is_paused'
  | 'public_supply'
  | 'public_price_usdc'
  | 'wallet_mint_limit'
  | 'presale_supply'
  | 'creator_presale_enabled'
  | 'active_phase'
  | 'creator_mint_price'
  | 'creator_mint_currency'
> {
  return {
    partner_allowlist_phases: [
      { key: 'team', label: 'Team', starts_at: past, supply: 10, price_usdc: 0 },
      { key: 'og', label: 'OG', starts_at: mid, supply: 40, price_usdc: 15 },
      { key: 'wl', label: 'Whitelist', starts_at: future, supply: 222, price_usdc: 9 },
    ],
    creator_wl_enabled: true,
    wl_supply: 272,
    wl_price_usdc: 9,
    phase_schedule: { PUBLIC: later },
    launch_deadline_at: past,
    is_paused: false,
    public_supply: 500,
    public_price_usdc: 25,
    wallet_mint_limit: 2,
    presale_supply: 0,
    creator_presale_enabled: false,
    active_phase: 'PUBLIC',
    creator_mint_price: null,
    creator_mint_currency: 'SOL',
    ...overrides,
  }
}

const rows = buildPartnerMintPhaseSchedule(launch(), now)
assert.equal(rows.length, 4, 'team + og + wl + public')
assert.equal(rows[0]!.key, 'team')
assert.equal(rows[0]!.status, 'ended')
assert.equal(rows[0]!.ends_at, mid)
assert.equal(rows[1]!.key, 'og')
assert.equal(rows[1]!.is_active, true)
assert.equal(rows[1]!.status, 'live')
assert.equal(rows[1]!.price_usdc, 15)
assert.equal(rows[1]!.wallet_mint_limit, 2)
assert.equal(rows[1]!.ends_at, future)
assert.equal(rows[2]!.key, 'wl')
assert.equal(rows[2]!.status, 'upcoming')
assert.equal(rows[2]!.price_usdc, 9)
assert.equal(rows[3]!.key, 'public')
assert.equal(rows[3]!.status, 'upcoming')
assert.equal(rows[3]!.price_usdc, 25)

const price = resolvePartnerMintUnitPrice(launch(), now)
assert.equal(price.from_allowlist, true)
assert.equal(price.price_usdc, 15)
assert.equal(price.allowlist_label, 'OG')

const afterPublic = resolvePartnerMintUnitPrice(launch(), Date.parse(later) + 1000)
assert.equal(afterPublic.from_allowlist, false)
assert.equal(afterPublic.price_usdc, 25)
assert.equal(afterPublic.price_sol, null)

const breppeLike = launch({
  partner_allowlist_phases: [
    { key: 'wl', label: 'Whitelist', starts_at: future, supply: 222, price_usdc: 9 },
  ],
  public_supply: 0,
  public_price_usdc: null,
  creator_mint_price: 0.15,
  creator_mint_currency: 'SOL',
  wl_supply: 222,
})
const breppePublic = resolvePartnerMintUnitPrice(breppeLike, Date.parse('2026-08-17T12:00:00.000Z'))
assert.equal(breppePublic.from_allowlist, false)
assert.equal(breppePublic.price_usdc, null)
assert.equal(breppePublic.price_sol, 0.15)
const breppeRows = buildPartnerMintPhaseSchedule(breppeLike, Date.parse('2026-08-17T12:00:00.000Z'))
assert.equal(breppeRows.find((r) => r.key === 'public')?.price_sol, 0.15)
assert.equal(breppeRows.find((r) => r.key === 'wl')?.price_usdc, 9)

const breppeNow = Date.parse('2026-08-17T12:00:00.000Z')
const breppeConsole = resolvePartnerMintConsolePhase(breppeLike, breppeNow)
assert.equal(breppeConsole?.key, 'wl')
assert.equal(formatPartnerMintConsolePriceBits(breppeConsole), '$9 USDC · pay in SOL')
assert.equal(
  formatPartnerMintConsolePriceBits(breppeRows.find((r) => r.key === 'public') ?? null),
  '0.15 SOL · pay in SOL'
)
assert.equal(publicSimpleSettlementLabel(breppeLike), 'WL in USDC · public in SOL')
assert.equal(
  resolvePartnerMintConsolePhase(breppeLike, Date.parse(later) + 1000)?.key,
  'public'
)

assert.equal(publicSimpleSolMintPrice(breppeLike), 0.15)
assert.equal(
  publicSimpleSolMintPrice(
    launch({
      public_price_usdc: 0,
      creator_mint_price: 0.15,
      creator_mint_currency: 'SOL',
    })
  ),
  0.15
)

assert.equal(formatPartnerPhasePriceUsdc(9), '$9 USDC')
assert.equal(formatPartnerPhasePriceUsdc(0), 'Free')
assert.equal(formatPartnerPhasePriceUsdc(null), 'TBA')

const ends = partnerAllowlistPhaseEndsAt(
  [
    { key: 'a', label: 'A', starts_at: past, supply: 1, price_usdc: 1 },
    { key: 'b', label: 'B', starts_at: mid, supply: 1, price_usdc: 2 },
  ],
  0,
  later
)
assert.equal(ends, mid)

const publicOnly = buildPartnerMintPhaseSchedule(
  launch({
    partner_allowlist_phases: [],
    creator_wl_enabled: false,
    wl_supply: 0,
    phase_schedule: { PUBLIC: past },
  }),
  now
)
assert.equal(publicOnly.length, 1)
assert.equal(publicOnly[0]!.key, 'public')
assert.equal(publicOnly[0]!.is_active, true)

console.log('ok — partner mint phase schedule')
