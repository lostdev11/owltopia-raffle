/**
 * Owl Council stake migration: legacy OWL escrow deposits → Owl Nesting (token pool).
 *
 * Cutoff = instant after which:
 * - New council escrow deposits are rejected (users use Nesting's Council pool).
 * - Vote weight is read from OWL staked in that nesting pool (same lock semantics as escrow).
 *
 * Optional announcement = when to start showing migration messaging (UI only).
 */

function parseIsoInstant(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const ms = Date.parse(raw.trim())
  return Number.isFinite(ms) ? ms : null
}

/** Server + client: banner / notices (behavior unchanged until cutoff). */
export function getCouncilStakeMigrationAnnouncementAtMs(): number | null {
  return parseIsoInstant(
    process.env.OWL_COUNCIL_STAKE_MIGRATION_ANNOUNCE_ISO ||
      process.env.NEXT_PUBLIC_OWL_COUNCIL_STAKE_MIGRATION_ANNOUNCE_ISO
  )
}

/** After this instant: escrow deposits blocked; votes use nesting pool stake. Server authority. */
export function getCouncilLegacyEscrowDepositCutoffMs(): number | null {
  return parseIsoInstant(process.env.OWL_COUNCIL_LEGACY_ESCROW_DEPOSIT_CUTOFF_AT)
}

/** Public copy for countdown (must match server env value). */
export function getCouncilLegacyEscrowDepositCutoffMsPublic(): number | null {
  return parseIsoInstant(process.env.NEXT_PUBLIC_OWL_COUNCIL_LEGACY_ESCROW_DEPOSIT_CUTOFF_AT)
}

export function councilStakeMigrationAnnounced(nowMs = Date.now()): boolean {
  const t = getCouncilStakeMigrationAnnouncementAtMs()
  if (t == null) return false
  return nowMs >= t
}

/** True once legacy escrow deposits must stop and nesting becomes vote source. */
export function isPastCouncilLegacyEscrowDepositCutoff(nowMs = Date.now()): boolean {
  const t = getCouncilLegacyEscrowDepositCutoffMs()
  if (t == null) return false
  return nowMs >= t
}

export function councilLegacyEscrowDepositsAreClosed(nowMs = Date.now()): boolean {
  return isPastCouncilLegacyEscrowDepositCutoff(nowMs)
}

/** Staking pool slug for OWL counted toward Owl Council votes (after cutoff). Default: owl-council-governance. */
export function getOwlCouncilGovernanceNestingPoolSlug(): string {
  return process.env.OWL_COUNCIL_GOVERNANCE_NESTING_POOL_SLUG?.trim() || 'owl-council-governance'
}

/**
 * Operational guidance (not enforced in code): typical migration window length.
 * Announce → cutoff is often **14 days** so holders can withdraw escrow OWL and re-stake in Nesting.
 */
export const RECOMMENDED_COUNCIL_MIGRATION_WINDOW_DAYS_MIN = 14
export const RECOMMENDED_COUNCIL_MIGRATION_WINDOW_DAYS_MAX = 14
