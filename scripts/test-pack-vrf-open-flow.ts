/**
 * Pack VRF open-flow helpers (attempt budget + recommit policy surface).
 * Run: npx tsx scripts/test-pack-vrf-open-flow.ts
 */
import assert from 'node:assert/strict'
import {
  resolvePackVrfAttemptRevealWaitMs,
  shouldStartPackVrfRecommit,
  PACK_VRF_WALL_CLOCK_MS,
  PACK_VRF_RECOMMIT_MIN_REMAINING_MS,
} from '../lib/packs/vrf-open-flow'
import { isRetryableVrfRevealError } from '../lib/raffles/draw/vrf-retry-policy'
import {
  PACK_OPEN_CLIENT_TIMEOUT_MS,
  PACK_OPEN_CLIENT_TIMEOUT_MESSAGE,
} from '../lib/client/execute-pack-purchase'
import { isTxConfirmTimeoutError } from '../lib/solana/confirm-tx-with-timeout'

function main() {
  // Longer first poll so InvalidSecpSignature can clear before recommit.
  assert.equal(resolvePackVrfAttemptRevealWaitMs(75_000), 54_000)
  assert.equal(resolvePackVrfAttemptRevealWaitMs(45_000), 32_400)
  assert.equal(resolvePackVrfAttemptRevealWaitMs(20_000), 25_000) // floor
  assert.equal(resolvePackVrfAttemptRevealWaitMs(200_000), 55_000) // cap

  // Pack recommit triggers on the same transient classes as raffle auto-recovery.
  assert.equal(
    isRetryableVrfRevealError(
      'VRF reveal timed out after 41250ms: Switchboard tx simulation failed: {"InstructionError":[2,{"Custom":6016}]} InvalidSecpSignature'
    ),
    true
  )
  assert.equal(
    isRetryableVrfRevealError(
      'VRF reveal timed out after 75000ms: Gateway: fetchRandomnessReveal failed (status 503, code ERR_BAD_RESPONSE)'
    ),
    true
  )
  // Commit-time BlockhashNotFound (prod: charged SOL, no animation) → recommit, not instant refund.
  assert.equal(
    isRetryableVrfRevealError('Switchboard tx simulation failed: "BlockhashNotFound"'),
    true
  )
  // Hung confirmTransaction (prod: stuck on Resolving prize…) → retryable after timeout.
  assert.equal(
    isTxConfirmTimeoutError('tx confirm timed out after 45000ms (5abc1234…)'),
    true
  )
  assert.equal(
    isRetryableVrfRevealError('tx confirm timed out after 45000ms (5abc1234…)'),
    true
  )
  assert.equal(isRetryableVrfRevealError('No escrow key configured for VRF fees'), false)

  // Wall-clock guard: do not start recommit when first attempt burned most of the budget.
  assert.equal(
    shouldStartPackVrfRecommit({
      wallClockMs: PACK_VRF_WALL_CLOCK_MS,
      elapsedMs: 10_000,
    }),
    true
  )
  assert.equal(
    shouldStartPackVrfRecommit({
      wallClockMs: PACK_VRF_WALL_CLOCK_MS,
      elapsedMs: PACK_VRF_WALL_CLOCK_MS - PACK_VRF_RECOMMIT_MIN_REMAINING_MS + 1,
    }),
    false
  )

  // Client abort must fire before Vercel kills the route (120s).
  assert.ok(PACK_OPEN_CLIENT_TIMEOUT_MS < 120_000)
  assert.ok(PACK_OPEN_CLIENT_TIMEOUT_MS >= 90_000)
  assert.ok(/support|refund/i.test(PACK_OPEN_CLIENT_TIMEOUT_MESSAGE))

  console.log(
    JSON.stringify(
      {
        ok: true,
        attemptWait75k: resolvePackVrfAttemptRevealWaitMs(75_000),
        attemptWaitCap: resolvePackVrfAttemptRevealWaitMs(200_000),
        wallClockMs: PACK_VRF_WALL_CLOCK_MS,
        clientTimeoutMs: PACK_OPEN_CLIENT_TIMEOUT_MS,
      },
      null,
      2
    )
  )
}

main()
