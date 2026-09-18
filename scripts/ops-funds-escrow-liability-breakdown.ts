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
  const holdSol = snap.pool.sol ?? 0
  const requiredSol = snap.liability.required.sol + snap.feeReserveSol
  const topUpSol = Math.max(0, requiredSol - holdSol)
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
        /** Send at least this much SOL to `hold.address` to clear the global claim/refund gate. */
        topUpSol,
        topUpAddress: snap.pool.address,
        buckets: snap.liability.buckets,
        counts: snap.liability.counts,
      },
      null,
      2
    )
  )
  if (!snap.coverage.covered && topUpSol > 0 && snap.pool.address) {
    console.error(
      `\nACTION: top up funds escrow ${snap.pool.address} with at least ${topUpSol.toFixed(5)} SOL, then retry claim-proceeds.`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
