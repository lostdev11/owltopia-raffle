/**
 * Smoke checks for referral growth program (run after migration 131).
 * Usage: npx tsx scripts/referral-growth-smoke.ts
 */
import { raffleSupportsReferralProgram, raffleEligibleForReferralFreeEntry } from '../lib/referrals/program'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

assert(!raffleSupportsReferralProgram({ currency: 'OWL' }), 'OWL ticket raffles excluded')
assert(!raffleSupportsReferralProgram({ currency: 'BAMBOO' }), 'BAMBOO ticket raffles excluded')
assert(raffleSupportsReferralProgram({ currency: 'SOL' }), 'SOL raffles included')
assert(raffleSupportsReferralProgram({ currency: 'USDC' }), 'USDC raffles included')

assert(
  !raffleEligibleForReferralFreeEntry({
    currency: 'OWL',
    is_active: true,
    end_time: new Date(Date.now() + 86400000).toISOString(),
  }),
  'OWL redemption blocked'
)

console.log('referral-growth-smoke: ok')
