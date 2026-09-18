#!/usr/bin/env node
/**
 * Ops: print funds-escrow liability buckets (same math as claim-proceeds gate).
 *
 * Usage:
 *   npx --yes tsx --env-file=.env.local scripts/ops-funds-escrow-liability-breakdown.ts
 */
import { getAppBuildId } from '../lib/app-build'
import { loadFundsEscrowLiabilityWithCoverage } from '../lib/raffles/funds-escrow-liability-service'

async function main() {
  const snap = await loadFundsEscrowLiabilityWithCoverage()
  console.log(
    JSON.stringify(
      {
        appBuildId: getAppBuildId(),
        covered: snap.coverage.covered,
        error: snap.coverage.error,
        feeReserveSol: snap.feeReserveSol,
        hold: snap.pool,
        required: snap.liability.required,
        shortfall: snap.coverage.shortfall,
        buckets: snap.liability.buckets,
        counts: snap.liability.counts,
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
