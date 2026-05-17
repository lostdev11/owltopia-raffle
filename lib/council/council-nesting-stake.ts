import { getStakingPoolBySlug } from '@/lib/db/staking-pools'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getTokenInfo } from '@/lib/tokens'
import {
  owlRawToDecimalString,
  owlUiToRawBigint,
} from '@/lib/council/owl-amount-format'

import {
  getOwlCouncilGovernanceNestingPoolSlug,
  isPastCouncilLegacyEscrowDepositCutoff,
} from '@/lib/council/council-stake-migration'

/**
 * Resolved council governance staking pool row (OWL token mint must match OWL mint when both set).
 */
export async function resolveOwlCouncilGovernanceNestingPool() {
  const slug = getOwlCouncilGovernanceNestingPoolSlug()
  const pool = await getStakingPoolBySlug(slug)
  if (!pool || pool.asset_type !== 'token') return null

  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) return null

  const mint = pool.token_mint?.trim()
  if (mint && mint !== owl.mintAddress.trim()) {
    return null
  }

  return { pool, owl }
}

/** Whether vote weight should be read from the council nesting pool (post-cutoff + pool usable). */
export async function councilNestingVoteWeightIsActive(nowMs = Date.now()): Promise<boolean> {
  if (!isPastCouncilLegacyEscrowDepositCutoff(nowMs)) return false
  const r = await resolveOwlCouncilGovernanceNestingPool()
  if (!r?.pool.token_mint?.trim()) return false
  return true
}

/**
 * Sum OWL UI amount → raw bigint via pool RPC SUM(amount) as numeric → convert.
 */
export async function getOwlCouncilNestingStakedRawSum(wallet: string): Promise<bigint> {
  const r = await resolveOwlCouncilGovernanceNestingPool()
  if (!r) return 0n

  const w = wallet.trim()
  if (!w) return 0n

  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.rpc('staking_sum_active_amount_for_pool', {
      p_wallet: w,
      p_pool_id: r.pool.id,
    })
    if (error || data == null) return 0n
    const n = Number(data)
    if (!Number.isFinite(n) || n <= 0) return 0n
    return owlUiToRawBigint(n, r.owl.decimals)
  } catch {
    return 0n
  }
}

export async function getOwlCouncilNestingVoteLockedRaw(
  walletAddress: string,
  decimals: number
): Promise<bigint> {
  const w = walletAddress.trim()
  if (!w || decimals < 0 || decimals > 9) return 0n

  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.rpc('owl_council_nesting_vote_locked_raw', {
      p_wallet: w,
      p_decimals: decimals,
    })
    if (error || data == null) return 0n
    const t = String(data).trim()
    if (!t) return 0n
    const whole = t.split(/[.eE]/)[0]
    if (!whole) return 0n
    try {
      return BigInt(whole)
    } catch {
      return 0n
    }
  } catch {
    return 0n
  }
}

export function formatNestingStakeWeightDecimal(raw: bigint, decimals: number): string {
  return owlRawToDecimalString(raw, decimals)
}
