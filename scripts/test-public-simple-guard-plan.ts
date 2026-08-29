/**
 * public_simple Candy Guard plan: SOL/USDC prices → on-chain solPayment groups.
 * Run: npx --yes tsx scripts/test-public-simple-guard-plan.ts
 */
import assert from 'node:assert/strict'

import {
  buildPublicSimpleGuardPlan,
  publicSimpleGuardGroupLabel,
  publicSimpleMintGuardGroupLabel,
  resolvePublicSimplePaymentDestination,
  solAmountToLamports,
  uniquePublicSimpleGuardGroupLabels,
} from '../lib/owl-center/public-simple-guard-plan'
import type { OwlCenterLaunchPublic } from '../lib/owl-center/types'

const DEST = 'DNoggcEL6DGdQAjaqxK7v5ktZchvXKtZdkaN6FPx2Fj1'

function launch(
  overrides: Partial<OwlCenterLaunchPublic> = {}
): Pick<
  OwlCenterLaunchPublic,
  | 'wallet_mint_limit'
  | 'launch_deadline_at'
  | 'phase_schedule'
  | 'creator_wl_enabled'
  | 'creator_presale_enabled'
  | 'wl_supply'
  | 'presale_supply'
  | 'wl_price_usdc'
  | 'public_price_usdc'
  | 'public_supply'
  | 'creator_mint_price'
  | 'creator_mint_currency'
  | 'treasury_wallet'
  | 'creator_wallet'
  | 'partner_allowlist_phases'
> {
  return {
    wallet_mint_limit: 2,
    launch_deadline_at: '2026-08-10T00:00:00.000Z',
    phase_schedule: {
      WHITELIST: '2026-08-24T11:48:00.000Z',
      PUBLIC: '2026-08-24T13:45:00.000Z',
    },
    creator_wl_enabled: true,
    creator_presale_enabled: false,
    wl_supply: 222,
    presale_supply: 0,
    wl_price_usdc: 9,
    public_price_usdc: null,
    public_supply: 0,
    creator_mint_price: 0.15,
    creator_mint_currency: 'SOL',
    treasury_wallet: DEST,
    creator_wallet: DEST,
    partner_allowlist_phases: [
      {
        key: 'wl',
        label: 'Whitelist',
        starts_at: '2026-08-24T11:48:00.000Z',
        supply: 222,
        price_usdc: 9,
        wallet_mint_limit: 4,
      },
    ],
    ...overrides,
  }
}

assert.equal(publicSimpleGuardGroupLabel('whitelist'), 'wl')
assert.equal(publicSimpleGuardGroupLabel('public'), 'pub')
assert.deepEqual(uniquePublicSimpleGuardGroupLabels(['wl', 'public']), ['wl', 'pub'])
assert.equal(solAmountToLamports(0.15), 150_000_000n)
assert.equal(resolvePublicSimplePaymentDestination(launch()), DEST)
assert.equal(publicSimpleMintGuardGroupLabel(launch(), null), 'pub')
assert.equal(publicSimpleMintGuardGroupLabel(launch(), 'wl'), 'wl')
assert.equal(publicSimpleMintGuardGroupLabel(launch({ partner_allowlist_phases: [], creator_wl_enabled: false, wl_supply: 0 }), null), null)

async function main() {
  const quoteUsdc = async (usdc: number) => BigInt(usdc * 1_000_000)

  const breppe = await buildPublicSimpleGuardPlan(launch(), { quoteUsdc })
  if (!breppe.ok) throw new Error(breppe.error)
  assert.equal(breppe.plan.groups.length, 2)
  assert.equal(breppe.plan.defaultSolLamports, 0n)
  assert.equal(breppe.plan.defaultStartDateIso, null)
  const wl = breppe.plan.groups.find((g) => g.label === 'wl')
  const pub = breppe.plan.groups.find((g) => g.label === 'pub')
  assert.ok(wl)
  assert.ok(pub)
  assert.equal(wl.solLamports, 9_000_000n)
  assert.equal(pub.solLamports, 150_000_000n)
  assert.equal(wl.endDateIso, '2026-08-24T13:45:00.000Z')
  assert.equal(pub.startDateIso, '2026-08-24T13:45:00.000Z')
  assert.equal(breppe.plan.destination, DEST)
  assert.equal(wl.walletMintLimit, 4)
  assert.equal(wl.mintLimitId, 2)
  assert.equal(pub.walletMintLimit, 2)
  assert.equal(pub.mintLimitId, 1)

  const publicOnly = await buildPublicSimpleGuardPlan(
    launch({
      partner_allowlist_phases: [],
      creator_wl_enabled: false,
      wl_supply: 0,
      launch_deadline_at: null,
      phase_schedule: { PUBLIC: '2026-08-24T13:45:00.000Z' },
    }),
    { quoteUsdc }
  )
  if (!publicOnly.ok) throw new Error(publicOnly.error)
  assert.equal(publicOnly.plan.groups.length, 0)
  assert.equal(publicOnly.plan.defaultSolLamports, 150_000_000n)
  assert.equal(publicOnly.plan.defaultStartDateIso, '2026-08-24T13:45:00.000Z')

  const simpleMovedBack = await buildPublicSimpleGuardPlan(
    launch({
      partner_allowlist_phases: [],
      creator_wl_enabled: false,
      wl_supply: 0,
      launch_deadline_at: '2026-08-10T00:00:00.000Z',
      phase_schedule: { PUBLIC: '2026-08-24T13:45:00.000Z' },
    }),
    { quoteUsdc }
  )
  if (!simpleMovedBack.ok) throw new Error(simpleMovedBack.error)
  assert.equal(simpleMovedBack.plan.defaultStartDateIso, '2026-08-10T00:00:00.000Z')

  const missingDest = await buildPublicSimpleGuardPlan(
    launch({ treasury_wallet: null, creator_wallet: null }),
    { quoteUsdc }
  )
  assert.equal(missingDest.ok, false)

  console.log('ok — public simple guard plan')
}

void main()
