/**
 * Switchboard VRF commit → reveal for a single pack open (same request).
 * Reuses raffle Switchboard helpers; stores VRF audit fields on pack_opens.
 *
 * Pack opens cannot wait for raffle-style cron re-commit (user is mid-checkout).
 * On retryable failures (InvalidSecpSignature / gateway 503 / timeout /
 * BlockhashNotFound on commit or reveal) we perform one fresh Switchboard
 * commit+reveal inside the same request before marking refund_needed.
 */

import {
  switchboardCommitRandomness,
  switchboardRevealRandomness,
  VRF_PROVIDER_SWITCHBOARD,
} from '@/lib/raffles/draw/vrf-switchboard'
import { isRetryableVrfRevealError } from '@/lib/raffles/draw/vrf-retry-policy'
import { updatePackOpen } from '@/lib/packs/db'
import { resolvePackVrfRevealWaitMs } from '@/lib/packs/vrf-config'
import { PACK_OPEN_ALGO_V2_VRF } from '@/lib/packs/config'
import { resolvePackSwitchboardCommitOptions } from '@/lib/packs/vrf-commit-options'
import { logVrfPhase, vrfPhaseTimer } from '@/lib/raffles/draw/vrf-timing-log'

export type PackVrfResult =
  | {
      ok: true
      openSeed: string
      requestTx: string
      fulfillTx: string
      randomnessAccount: string
    }
  | {
      ok: false
      error: string
      requestTx?: string | null
      randomnessAccount?: string | null
    }

/** Per-attempt reveal budget so commit + optional recommit fit in maxDuration 120s. */
export function resolvePackVrfAttemptRevealWaitMs(totalBudgetMs?: number): number {
  const total =
    typeof totalBudgetMs === 'number' && Number.isFinite(totalBudgetMs) && totalBudgetMs > 0
      ? Math.floor(totalBudgetMs)
      : resolvePackVrfRevealWaitMs()
  // Two attempts share the serverless window; leave headroom for commit txs (~10–15s each).
  // Bias toward a longer first poll — InvalidSecpSignature often clears with time on the
  // same account; a short 41s window was failing both attempts in prod.
  return Math.max(25_000, Math.min(55_000, Math.floor(total * 0.72)))
}

/**
 * Wall-clock budget for the whole pack VRF path (commit + reveal + optional recommit).
 * Must stay under route maxDuration (120s) with margin for prize payout after VRF.
 */
export const PACK_VRF_WALL_CLOCK_MS = 100_000

/** Minimum remaining wall time required to start a fresh recommit+reveal. */
export const PACK_VRF_RECOMMIT_MIN_REMAINING_MS = 28_000

export function shouldStartPackVrfRecommit(params: {
  wallClockMs: number
  elapsedMs: number
  minRemainingMs?: number
}): boolean {
  const minRemaining = params.minRemainingMs ?? PACK_VRF_RECOMMIT_MIN_REMAINING_MS
  return params.wallClockMs - params.elapsedMs >= minRemaining
}

async function commitAndRevealOnce(params: {
  openId: string
  revealWaitMs: number
  attemptLabel: 'first' | 'recommit'
}): Promise<PackVrfResult> {
  const attemptTimer = vrfPhaseTimer()
  const commit = await switchboardCommitRandomness(resolvePackSwitchboardCommitOptions())
  if (!commit.ok) {
    logVrfPhase('pack', 'vrf.attempt_failed', attemptTimer.elapsed(), {
      attempt: params.attemptLabel,
      stage: 'commit',
    })
    await updatePackOpen(params.openId, {
      open_algo: PACK_OPEN_ALGO_V2_VRF,
      open_vrf_provider: VRF_PROVIDER_SWITCHBOARD,
      open_vrf_status: 'failed',
      open_vrf_error: commit.error,
      open_vrf_account: null,
      open_vrf_request_tx: null,
      open_vrf_fulfill_tx: null,
    } as Parameters<typeof updatePackOpen>[1])
    return { ok: false, error: commit.error }
  }

  await updatePackOpen(params.openId, {
    open_algo: PACK_OPEN_ALGO_V2_VRF,
    open_vrf_provider: VRF_PROVIDER_SWITCHBOARD,
    open_vrf_status: 'pending',
    open_vrf_account: commit.randomnessAccount,
    open_vrf_request_tx: commit.commitTx,
    open_vrf_fulfill_tx: null,
    open_vrf_error: null,
  } as Parameters<typeof updatePackOpen>[1])

  const reveal = await switchboardRevealRandomness({
    randomnessAccount: commit.randomnessAccount,
    randomnessSecretKeyBase58: commit.randomnessSecretKeyBase58,
    maxWaitMs: params.revealWaitMs,
    seedSlot: commit.seedSlot,
    timingScope: 'pack',
  })

  if (!reveal.ok) {
    logVrfPhase('pack', 'vrf.attempt_failed', attemptTimer.elapsed(), {
      attempt: params.attemptLabel,
      stage: 'reveal',
    })
    await updatePackOpen(params.openId, {
      open_vrf_status: 'failed',
      open_vrf_error: reveal.error,
    } as Parameters<typeof updatePackOpen>[1])
    return {
      ok: false,
      error: reveal.error,
      requestTx: commit.commitTx,
      randomnessAccount: commit.randomnessAccount,
    }
  }

  await updatePackOpen(params.openId, {
    open_vrf_status: 'fulfilled',
    open_vrf_fulfill_tx: reveal.revealTx,
    open_vrf_error: null,
  } as Parameters<typeof updatePackOpen>[1])

  logVrfPhase('pack', 'vrf.attempt_ok', attemptTimer.elapsed(), {
    attempt: params.attemptLabel,
  })

  return {
    ok: true,
    openSeed: reveal.drawSeed,
    requestTx: commit.commitTx,
    fulfillTx: reveal.revealTx,
    randomnessAccount: commit.randomnessAccount,
  }
}

/**
 * Commit + reveal Switchboard randomness for this open.
 * On failure, patches open row with open_vrf_status=failed and returns error
 * (caller should set refund_needed).
 */
export async function runPackOpenVrf(openId: string): Promise<PackVrfResult> {
  const wallStarted = Date.now()
  const totalBudgetMs = resolvePackVrfRevealWaitMs()
  const attemptWaitMs = resolvePackVrfAttemptRevealWaitMs(totalBudgetMs)
  logVrfPhase('pack', 'vrf.run_start', 0, {
    openId,
    attemptWaitMs,
    totalBudgetMs,
  })

  const first = await commitAndRevealOnce({
    openId,
    revealWaitMs: attemptWaitMs,
    attemptLabel: 'first',
  })
  if (first.ok) {
    logVrfPhase('pack', 'vrf.run_ok', Date.now() - wallStarted, { openId, attempts: 1 })
    return first
  }

  // One fresh commit+reveal for transient oracle Secp / gateway / blockhash / confirm-timeout
  // failures before refund — but only if enough wall-clock remains under maxDuration.
  if (!isRetryableVrfRevealError(first.error)) {
    return first
  }

  const elapsedMs = Date.now() - wallStarted
  if (!shouldStartPackVrfRecommit({ wallClockMs: PACK_VRF_WALL_CLOCK_MS, elapsedMs })) {
    await updatePackOpen(openId, {
      open_vrf_status: 'failed',
      open_vrf_error: `${first.error} (skipped recommit — insufficient time remaining)`,
    } as Parameters<typeof updatePackOpen>[1])
    return {
      ok: false,
      error: `${first.error} (skipped recommit — insufficient time remaining)`,
      requestTx: first.requestTx,
      randomnessAccount: first.randomnessAccount,
    }
  }

  const remainingMs = Math.max(20_000, PACK_VRF_WALL_CLOCK_MS - elapsedMs)
  const secondWaitMs = resolvePackVrfAttemptRevealWaitMs(remainingMs)

  await updatePackOpen(openId, {
    open_vrf_status: 'pending',
    open_vrf_error: `Retrying with fresh Switchboard commit after: ${first.error}`,
  } as Parameters<typeof updatePackOpen>[1])

  const second = await commitAndRevealOnce({
    openId,
    revealWaitMs: secondWaitMs,
    attemptLabel: 'recommit',
  })
  if (second.ok) {
    logVrfPhase('pack', 'vrf.run_ok', Date.now() - wallStarted, { openId, attempts: 2 })
    return second
  }

  // Prefer the second attempt's error (fresher), keep audit trail of first account in message.
  const combined = second.error
    ? `${second.error} (after recommit; prior: ${first.randomnessAccount ?? 'none'})`
    : first.error
  await updatePackOpen(openId, {
    open_vrf_status: 'failed',
    open_vrf_error: combined,
  } as Parameters<typeof updatePackOpen>[1])
  logVrfPhase('pack', 'vrf.run_failed', Date.now() - wallStarted, { openId, attempts: 2 })

  return {
    ok: false,
    error: combined,
    requestTx: second.requestTx ?? first.requestTx,
    randomnessAccount: second.randomnessAccount ?? first.randomnessAccount,
  }
}
