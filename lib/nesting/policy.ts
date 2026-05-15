import { StakingUserError } from '@/lib/nesting/errors'
import type { StakingPoolRow } from '@/lib/db/staking-pools'

/** Canonical Owl Nest staking: 1 OWL per NFT per day (rounded by emission policy validation). */
const DEFAULT_DAILY_OWL_PER_NFT = 1
const DEFAULT_SELL_OUT_REQUIRED = true

function readNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function readBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  return fallback
}

/**
 * When true (via `NESTING_DISABLED=true`), stake / claim / unstake are rejected server-side.
 * Use for maintenance or incident response. Mid-stake NFT freeze confirmation stays available in the UI.
 */
export function isNestingGloballyDisabled(): boolean {
  return readBoolean(process.env.NESTING_DISABLED, false)
}

export function assertNestingOperationsAllowed(): void {
  if (isNestingGloballyDisabled()) {
    throw new StakingUserError(
      'Nesting is paused right now. New nests, claims, and leaving a nest are temporarily unavailable—please try again later.',
      503
    )
  }
}

export function isNestingSelloutRequired(): boolean {
  return readBoolean(process.env.NESTING_SELL_OUT_REQUIRED, DEFAULT_SELL_OUT_REQUIRED)
}

export function isNestingSelloutReached(): boolean {
  if (!isNestingSelloutRequired()) return true

  const at = process.env.NESTING_SELL_OUT_AT?.trim()
  if (at) {
    const ms = Date.parse(at)
    if (Number.isFinite(ms)) {
      return Date.now() >= ms
    }
  }

  // When unset, default true so staking is open unless you explicitly set REACHED=false or use SELL_OUT_AT.
  return readBoolean(process.env.NESTING_SELL_OUT_REACHED, true)
}

export function assertNestingSelloutReached(): void {
  if (!isNestingSelloutReached()) {
    throw new StakingUserError(
      'Staking opens only after sellout. Sellout gate is still active.',
      403
    )
  }
}

export function getRequiredDailyOwlPerNft(): number {
  return readNumber(process.env.NESTING_OWL_DAILY_REWARD_PER_NFT, DEFAULT_DAILY_OWL_PER_NFT)
}

export function getNestingRewardTreasuryWallet(): string {
  return process.env.NESTING_OWL_REWARD_TREASURY_WALLET?.trim() || ''
}

/** When true, OWL reward claims may succeed with database-only credits (no SPL transfer). Default false. */
export function isNestingDbOnlyOwlClaimsAllowed(): boolean {
  return readBoolean(process.env.NESTING_ALLOW_DB_ONLY_OWL_CLAIMS, false)
}

export function validatePoolAgainstNestingEmissionPolicy(pool: Pick<
  StakingPoolRow,
  'asset_type' | 'reward_token' | 'reward_rate' | 'reward_rate_unit'
>): void {
  if (pool.asset_type !== 'nft') return
  const rewardToken = pool.reward_token?.trim().toUpperCase()
  if (rewardToken !== 'OWL') {
    throw new StakingUserError(
      'NFT nesting pools must pay rewards in OWL under current emissions policy.',
      400
    )
  }
  if (pool.reward_rate_unit !== 'daily') {
    throw new StakingUserError(
      'NFT nesting pools must use daily reward rate unit.',
      400
    )
  }
  const required = getRequiredDailyOwlPerNft()
  const actual = Number(pool.reward_rate)
  if (Math.abs(actual - required) > 1e-9) {
    throw new StakingUserError(
      `NFT nesting pools must use ${required} OWL/day reward rate.`,
      400
    )
  }
}

export function assertRewardTreasuryConfigured(): void {
  if (!getNestingRewardTreasuryWallet()) {
    throw new StakingUserError(
      'NESTING_OWL_REWARD_TREASURY_WALLET is required before on-chain staking can run.',
      503
    )
  }
}
