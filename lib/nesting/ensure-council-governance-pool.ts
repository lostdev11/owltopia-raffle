import { getStakingPoolBySlug, updateStakingPool } from '@/lib/db/staking-pools'
import { getOwlCouncilGovernanceNestingPoolSlug } from '@/lib/council/council-stake-migration'
import { getTokenInfo } from '@/lib/tokens'

/**
 * When OWL mint is configured in env, ensure the council governance perch is active
 * and has token_mint set (migration 108 seeds the row inactive with null mint).
 */
export async function ensureOwlCouncilGovernancePoolReady(): Promise<void> {
  try {
    const slug = getOwlCouncilGovernanceNestingPoolSlug()
    const pool = await getStakingPoolBySlug(slug)
    if (!pool || pool.asset_type !== 'token') return

    const owlMint = getTokenInfo('OWL').mintAddress?.trim()
    if (!owlMint) return

    const needsMint = !pool.token_mint?.trim()
    const needsActivate = !pool.is_active
    if (!needsMint && !needsActivate) return

    await updateStakingPool(pool.id, {
      ...(needsMint ? { token_mint: owlMint, stake_mint: owlMint } : {}),
      ...(needsActivate ? { is_active: true } : {}),
    })
  } catch (e) {
    console.error('[nesting] ensureOwlCouncilGovernancePoolReady:', e)
  }
}
