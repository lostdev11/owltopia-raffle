/**
 * Pack VRF open-flow helpers (attempt budget + recommit policy surface).
 * Run: npx tsx scripts/test-pack-vrf-open-flow.ts
 */
import assert from 'node:assert/strict'
import { resolvePackVrfAttemptRevealWaitMs } from '../lib/packs/vrf-open-flow'
import { isRetryableVrfRevealError } from '../lib/raffles/draw/vrf-retry-policy'

function main() {
  // Two attempts must fit in ~120s serverless budget with commit overhead.
  assert.equal(resolvePackVrfAttemptRevealWaitMs(75_000), 41_250)
  assert.equal(resolvePackVrfAttemptRevealWaitMs(45_000), 24_750)
  assert.equal(resolvePackVrfAttemptRevealWaitMs(20_000), 20_000) // floor
  assert.equal(resolvePackVrfAttemptRevealWaitMs(200_000), 45_000) // cap

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
  assert.equal(isRetryableVrfRevealError('No escrow key configured for VRF fees'), false)

  console.log(
    JSON.stringify(
      {
        ok: true,
        attemptWait75k: resolvePackVrfAttemptRevealWaitMs(75_000),
        attemptWaitCap: resolvePackVrfAttemptRevealWaitMs(200_000),
      },
      null,
      2
    )
  )
}

main()
