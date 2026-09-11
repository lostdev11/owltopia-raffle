/**
 * Partner share of Owltopia platform mint fee (~$1 SOL / NFT).
 * Accrued locked on confirm-mint; released after mint ends or via admin override.
 */

export const OWL_CENTER_PLATFORM_FEE_REBATE_STATES = [
  'locked',
  'releasable',
  'released',
  'forfeited',
] as const

export type OwlCenterPlatformFeeRebateState = (typeof OWL_CENTER_PLATFORM_FEE_REBATE_STATES)[number]

/** Savi3 / Loud Lords deal default — 20% of platform mint fee. */
export const OWL_CENTER_DEFAULT_PARTNER_PLATFORM_FEE_REBATE_BPS = 2000

export function clampPlatformFeeRebateBps(raw: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(10_000, n)
}

/** Integer lamports: floor(fee * bps / 10000). */
export function computePlatformFeeRebateLamports(feeLamports: bigint, bps: number): bigint {
  const clamped = clampPlatformFeeRebateBps(bps)
  if (feeLamports <= 0n || clamped <= 0) return 0n
  return (feeLamports * BigInt(clamped)) / 10000n
}

export function isPlatformFeeRebateEnabled(launch: {
  platform_fee_rebate_bps?: number | null
  platform_fee_rebate_wallet?: string | null
}): boolean {
  return (
    clampPlatformFeeRebateBps(launch.platform_fee_rebate_bps) > 0 &&
    Boolean(launch.platform_fee_rebate_wallet?.trim())
  )
}

/** Mint is over — locked rebates may become releasable / auto-paid. */
export function isOwlCenterLaunchMintEndedForRebate(launch: {
  active_phase?: string | null
  status?: string | null
  minted_count?: number | null
  total_supply?: number | null
}): boolean {
  const phase = String(launch.active_phase ?? '')
  const status = String(launch.status ?? '')
  if (phase === 'SOLD_OUT' || phase === 'TRADING_ACTIVE') return true
  if (status === 'SOLD_OUT' || status === 'TRADING_ACTIVE') return true
  const minted = Number(launch.minted_count ?? 0)
  const supply = Number(launch.total_supply ?? 0)
  return supply > 0 && minted >= supply
}

/** Accrue skip reasons that mean "already recorded" (idempotent confirm). */
export function isPlatformFeeRebateAccrueDuplicate(skipped: string | null | undefined): boolean {
  return skipped === 'duplicate'
}

/**
 * State transition when mint ends: locked → releasable.
 * Returns null when no transition applies.
 */
export function platformFeeRebateStateAfterMintEnd(
  state: OwlCenterPlatformFeeRebateState
): OwlCenterPlatformFeeRebateState | null {
  return state === 'locked' ? 'releasable' : null
}

/**
 * Admin forfeit override: locked or releasable → forfeited.
 * Returns null when the row cannot be forfeited from its current state.
 */
export function platformFeeRebateStateAfterAdminForfeit(
  state: OwlCenterPlatformFeeRebateState
): OwlCenterPlatformFeeRebateState | null {
  if (state === 'locked' || state === 'releasable') return 'forfeited'
  return null
}

/**
 * Admin release: releasable (or locked if force) → released.
 */
export function platformFeeRebateStateAfterAdminRelease(
  state: OwlCenterPlatformFeeRebateState,
  opts?: { includeLocked?: boolean }
): OwlCenterPlatformFeeRebateState | null {
  if (state === 'releasable') return 'released'
  if (opts?.includeLocked && state === 'locked') return 'released'
  return null
}


