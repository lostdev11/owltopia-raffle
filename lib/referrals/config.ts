import { getReferralRewardSettings } from '@/lib/db/referral-rewards'

const PROGRAM_ENABLED_CACHE_MS = 5000
let programEnabledCache: { at: number; value: boolean } | null = null

/** Cleared after admin PATCH so toggles take effect within a few seconds cluster-wide per instance. */
export function invalidateReferralProgramEnabledCache(): void {
  programEnabledCache = null
}

/**
 * When `REFERRAL_ATTRIBUTION_ENABLED=false`, we do not persist referrer on new entries.
 * Use for dry-runs; default is enabled when unset.
 */
export function isReferralAttributionEnabled(): boolean {
  return process.env.REFERRAL_ATTRIBUTION_ENABLED !== 'false'
}

/**
 * Creator growth program: paid-first referral rewards, monthly caps, analytics.
 * Default on when unset.
 */
export function isReferralGrowthProgramEnabled(): boolean {
  return process.env.REFERRAL_GROWTH_PROGRAM_ENABLED !== 'false'
}

/**
 * Legacy buyer free ticket at checkout (before first paid entry).
 * Disabled when growth program is on unless explicitly enabled in DB settings.
 */
export function isReferralComplimentaryTicketEnabled(): boolean {
  if (isReferralGrowthProgramEnabled()) {
    return process.env.REFERRAL_COMPLIMENTARY_TICKET_ENABLED === 'true'
  }
  return process.env.REFERRAL_COMPLIMENTARY_TICKET_ENABLED === 'true'
}

/** Env kill switches for admin UI (deployment-level overrides). */
export function referralEnvKillSwitchStatus(): {
  attributionDisabled: boolean
  growthDisabled: boolean
} {
  return {
    attributionDisabled: process.env.REFERRAL_ATTRIBUTION_ENABLED === 'false',
    growthDisabled: process.env.REFERRAL_GROWTH_PROGRAM_ENABLED === 'false',
  }
}

/**
 * Master referral program gate: env kill switches + admin `program_enabled` in DB.
 * Default on when unset or row missing.
 */
export async function isReferralProgramEnabled(): Promise<boolean> {
  if (process.env.REFERRAL_ATTRIBUTION_ENABLED === 'false') return false
  if (process.env.REFERRAL_GROWTH_PROGRAM_ENABLED === 'false') return false

  const now = Date.now()
  if (programEnabledCache && now - programEnabledCache.at < PROGRAM_ENABLED_CACHE_MS) {
    return programEnabledCache.value
  }

  const settings = await getReferralRewardSettings()
  const value = settings.program_enabled !== false
  programEnabledCache = { at: now, value }
  return value
}

export async function isReferralAttributionActive(): Promise<boolean> {
  return (await isReferralProgramEnabled()) && isReferralAttributionEnabled()
}

export async function isReferralGrowthProgramActive(): Promise<boolean> {
  return (await isReferralProgramEnabled()) && isReferralGrowthProgramEnabled()
}
