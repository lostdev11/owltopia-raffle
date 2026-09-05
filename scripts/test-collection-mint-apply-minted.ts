/**
 * Unit checks for collection mint eligibility optimistic debit (Breppe double-mint guard).
 *
 * Run: npx --yes tsx scripts/test-collection-mint-apply-minted.ts
 */
import type { SimpleMintEligibilityResponse } from '@/lib/owl-center/types'

/** Mirrors hooks/use-collection-mint-eligibility applyMinted reducer. */
function applyMinted(
  prev: SimpleMintEligibilityResponse,
  quantity: number
): SimpleMintEligibilityResponse {
  const debit = Math.max(0, Math.floor(quantity))
  if (debit <= 0) return prev
  const nextMax = Math.max(0, prev.max_mintable - debit)
  const nextMinted = prev.wallet_minted + debit
  return {
    ...prev,
    max_mintable: nextMax,
    wallet_minted: nextMinted,
    is_eligible: prev.is_eligible && nextMax > 0,
    reason:
      nextMax > 0 ? prev.reason : `Wallet limit reached (${prev.wallet_mint_limit} per wallet)`,
  }
}

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  - ${name}`)
  else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

const base: SimpleMintEligibilityResponse = {
  active_phase: 'PUBLIC',
  status: 'PUBLIC',
  is_paused: false,
  is_eligible: true,
  max_mintable: 1,
  reason: 'Eligible for public · up to 1 mint',
  wallet_minted: 0,
  wallet_mint_limit: 1,
  unit_lamports_estimate: null,
  sol_usd_price: null,
  price_usdc: null,
  price_sol: 0.15,
  active_allowlist_key: null,
  active_allowlist_label: null,
  platform_mint_fee_usdc: 1,
  platform_mint_fee_lamports_estimate: '10000000',
  platform_mint_fee_label: '~0.01 SOL',
  wallet_sol_balance_lamports: null,
  mint_sol_needed_lamports: null,
  platform_treasury_wallet: null,
  mint_network: 'mainnet',
  mint_operational: true,
  mint_window_open: true,
  phase_starts_at: null,
  on_allowlist: null,
  allowlist_spots_remaining: null,
}

console.log('Collection mint applyMinted:')

{
  const next = applyMinted(base, 1)
  check('debits max_mintable to 0', next.max_mintable === 0)
  check('increments wallet_minted', next.wallet_minted === 1)
  check('clears is_eligible', next.is_eligible === false)
  check('sets limit-reached reason', next.reason?.includes('Wallet limit reached') === true)
}

{
  const two: SimpleMintEligibilityResponse = { ...base, max_mintable: 2, wallet_mint_limit: 2 }
  const next = applyMinted(two, 1)
  check('partial debit keeps eligible', next.is_eligible === true && next.max_mintable === 1)
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll collection applyMinted checks passed.')
