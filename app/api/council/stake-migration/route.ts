import { NextResponse } from 'next/server'

import {
  councilStakeMigrationAnnounced,
  councilLegacyEscrowDepositsAreClosed,
  getCouncilLegacyEscrowDepositCutoffMs,
  getCouncilLegacyEscrowDepositCutoffMsPublic,
  getCouncilStakeMigrationAnnouncementAtMs,
  getOwlCouncilGovernanceNestingPoolSlug,
  RECOMMENDED_COUNCIL_MIGRATION_WINDOW_DAYS_MIN,
  RECOMMENDED_COUNCIL_MIGRATION_WINDOW_DAYS_MAX,
} from '@/lib/council/council-stake-migration'
import { councilNestingVoteWeightIsActive } from '@/lib/council/council-nesting-stake'

export const dynamic = 'force-dynamic'

/**
 * GET /api/council/stake-migration
 * Public migration status for UI (announce + escrow deposit cutoff vs nesting votes).
 */
export async function GET() {
  try {
    const now = Date.now()
    const cutoffServer = getCouncilLegacyEscrowDepositCutoffMs()
    const cutoffPublic = getCouncilLegacyEscrowDepositCutoffMsPublic()
    const nestingConfigured = await councilNestingVoteWeightIsActive(now)

    const opMin = RECOMMENDED_COUNCIL_MIGRATION_WINDOW_DAYS_MIN
    const opMax = RECOMMENDED_COUNCIL_MIGRATION_WINDOW_DAYS_MAX
    const operationalNote =
      opMin === opMax
        ? `Typical announcement→cutoff window: ${opMin} days.`
        : `Typical announcement→cutoff window: ${opMin}–${opMax} days.`

    return NextResponse.json({
      announceAtMs: getCouncilStakeMigrationAnnouncementAtMs(),
      legacyEscrowDepositCutoffAtMs: cutoffServer ?? cutoffPublic,
      announcementActive: councilStakeMigrationAnnounced(now),
      legacyEscrowDepositsClosed: councilLegacyEscrowDepositsAreClosed(now),
      nestingVoteSourceReady: nestingConfigured,
      nestingCouncilPoolSlug: getOwlCouncilGovernanceNestingPoolSlug(),
      nestingDashboardUrl: '/dashboard/nesting',
      operationalNote,
    })
  } catch (e) {
    console.error('[api/council/stake-migration]', e)
    return NextResponse.json({ error: 'Failed to load migration status.' }, { status: 500 })
  }
}
