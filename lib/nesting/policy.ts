import { isNestingOperationsPausedInDb } from '@/lib/db/nesting-public-settings'
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

function nestingDisabledEnvRaw(): string | undefined {
  if (typeof process === 'undefined') return undefined
  // Dynamic key so Next/webpack is less likely to substitute a *build-time* value for `NESTING_DISABLED` into server
  // chunks. Production should read the variable from the runtime environment after you change it in Vercel + redeploy.
  return process.env['NESTING_' + 'DISABLED']
}

/**
 * When true (via `NESTING_DISABLED=true`), stake / claim / unstake are rejected server-side.
 * Use for maintenance or incident response that must override admin UI. Mid-flight MPL Core freeze completion still uses
 * `POST /api/me/staking/stake` with the same NFT (resume path in `executeStake`) and `POST /api/me/staking/freeze`.
 */
export function isNestingEnvKillSwitchEnabled(): boolean {
  return readBoolean(nestingDisabledEnvRaw(), false)
}

export type NestingActionsPauseBreakdown = {
  /** True when either lever is blocking holder actions. */
  disabled: boolean
  /** `NESTING_DISABLED` deployment env (cannot be overridden by admin pause switch). */
  envKillSwitch: boolean
  /** `nesting_public_settings.nesting_operations_paused` (admin “Pause holder actions”). */
  adminDbPaused: boolean
}

/**
 * Single DB read plus env: use when you need to explain *why* nesting is paused in the UI.
 */
export async function getNestingActionsPauseBreakdown(): Promise<NestingActionsPauseBreakdown> {
  const envKillSwitch = isNestingEnvKillSwitchEnabled()
  const adminDbPaused = await isNestingOperationsPausedInDb()
  return {
    envKillSwitch,
    adminDbPaused,
    disabled: envKillSwitch || adminDbPaused,
  }
}

/**
 * True when nesting stake / claim / voluntary unstake should be blocked (UI banner + APIs).
 * Uses `NESTING_DISABLED` **or** admin-controlled `nesting_public_settings.nesting_operations_paused`.
 */
export async function isNestingGloballyDisabled(): Promise<boolean> {
  if (isNestingEnvKillSwitchEnabled()) return true
  return isNestingOperationsPausedInDb()
}

export async function assertNestingOperationsAllowed(): Promise<void> {
  if (await isNestingGloballyDisabled()) {
    throw new StakingUserError(
      'Nesting is paused right now. New nests, claims, and leaving a nest are temporarily unavailable—please try again later.',
      503
    )
  }
}

/** Claims stay available during admin “pause holder actions”; only the deploy kill switch blocks payouts. */
export function assertNestingClaimsAllowed(): void {
  if (isNestingEnvKillSwitchEnabled()) {
    throw new StakingUserError(
      'OWL claims are paused for maintenance (NESTING_DISABLED). Try again after the team clears the deployment flag.',
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

/** When true, `POST /api/me/staking/claim-all` is rejected (single-nest claim still allowed). */
export function isNestingClaimAllDisabled(): boolean {
  return readBoolean(process.env.NESTING_CLAIM_ALL_DISABLED, false)
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
