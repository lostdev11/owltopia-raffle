import { isNestingOperationsPausedInDb } from '@/lib/db/nesting-public-settings'
import { StakingUserError } from '@/lib/nesting/errors'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'

/** Canonical Owl Nest staking: 1 OWL per NFT per day (suggested default for the legacy perch). */
const DEFAULT_DAILY_OWL_PER_NFT = 1
/**
 * Allowed OWL/day band for NFT nesting pools. Replaces the old "exactly 1 OWL/day" rule so lock-tiered
 * Gen2 perches (e.g. 0.1/day for 90-day, 0.3/day for 180-day) validate while still rejecting fat-fingered
 * rates. The canonical 1 OWL/day perch stays inside the default band. Override via env if tokenomics change.
 */
const DEFAULT_DAILY_OWL_PER_NFT_MIN = 0
const DEFAULT_DAILY_OWL_PER_NFT_MAX = 100
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

/** Suggested default OWL/day rate for a new NFT perch (used as a UI hint; no longer hard-enforced). */
export function getRequiredDailyOwlPerNft(): number {
  return readNumber(process.env.NESTING_OWL_DAILY_REWARD_PER_NFT, DEFAULT_DAILY_OWL_PER_NFT)
}

/**
 * Allowed [min, max] OWL/day band an NFT perch's `reward_rate` must fall within. Defaults comfortably
 * include the canonical 1 OWL/day perch and the Gen2 0.1/0.3 lock tiers. Configure via
 * `NESTING_OWL_DAILY_REWARD_MIN` / `NESTING_OWL_DAILY_REWARD_MAX`.
 */
export function getNestingDailyOwlRewardBand(): { min: number; max: number } {
  const min = readNumber(process.env.NESTING_OWL_DAILY_REWARD_MIN, DEFAULT_DAILY_OWL_PER_NFT_MIN)
  const max = readNumber(process.env.NESTING_OWL_DAILY_REWARD_MAX, DEFAULT_DAILY_OWL_PER_NFT_MAX)
  // Guard against an inverted band misconfig (min > max) collapsing to "nothing is valid".
  if (min > max) return { min: max, max: min }
  return { min, max }
}

export function getNestingRewardTreasuryWallet(): string {
  return process.env.NESTING_OWL_REWARD_TREASURY_WALLET?.trim() || ''
}

/** Treasury for staking platform fees (same wallet as launchpad mint fees). */
export function getStakingPlatformFeeTreasuryWallet(): string {
  return getPlatformFeeTreasuryWalletAddress() ?? ''
}

/** When true, OWL reward claims may succeed with database-only credits (no SPL transfer). Default false. */
export function isNestingDbOnlyOwlClaimsAllowed(): boolean {
  return readBoolean(process.env.NESTING_ALLOW_DB_ONLY_OWL_CLAIMS, false)
}

/** When true, `POST /api/me/staking/claim-all` is rejected (single-nest claim still allowed). */
export function isNestingClaimAllDisabled(): boolean {
  return readBoolean(process.env.NESTING_CLAIM_ALL_DISABLED, false)
}

const DEFAULT_CLAIM_ALL_BATCH_SIZE = 25

/** Max nests per Claim-all server batch (SPL + ledger). Override: `NESTING_CLAIM_ALL_BATCH_SIZE`. */
export function getClaimAllBatchSize(): number {
  const raw = process.env.NESTING_CLAIM_ALL_BATCH_SIZE?.trim()
  const n = raw ? Number(raw) : DEFAULT_CLAIM_ALL_BATCH_SIZE
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CLAIM_ALL_BATCH_SIZE
  return Math.min(Math.floor(n), 100)
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
  const actual = Number(pool.reward_rate)
  if (!Number.isFinite(actual)) {
    throw new StakingUserError('NFT nesting pools must have a numeric OWL/day reward rate.', 400)
  }
  const { min, max } = getNestingDailyOwlRewardBand()
  // 1e-9 tolerance avoids float edge cases right at the band boundary (e.g. 0.1 stored as 0.0999999…).
  if (actual < min - 1e-9 || actual > max + 1e-9) {
    throw new StakingUserError(
      `NFT nesting pools must use an OWL/day reward rate between ${min} and ${max}.`,
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
