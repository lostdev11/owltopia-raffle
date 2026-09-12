/**
 * Switchboard VRF commit → reveal for a single pack open (same request).
 * Reuses raffle Switchboard helpers; stores VRF audit fields on pack_opens.
 *
 * Pack opens cannot wait for raffle-style cron re-commit (user is mid-checkout).
 * On retryable reveal failures (InvalidSecpSignature / gateway 503 / timeout) we
 * perform one fresh Switchboard commit+reveal inside the same request before
 * marking refund_needed.
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
  return Math.max(20_000, Math.min(45_000, Math.floor(total * 0.55)))
}

async function commitAndRevealOnce(params: {
  openId: string
  revealWaitMs: number
}): Promise<PackVrfResult> {
  const commit = await switchboardCommitRandomness()
  if (!commit.ok) {
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
  })

  if (!reveal.ok) {
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
  const totalBudgetMs = resolvePackVrfRevealWaitMs()
  const attemptWaitMs = resolvePackVrfAttemptRevealWaitMs(totalBudgetMs)

  const first = await commitAndRevealOnce({ openId, revealWaitMs: attemptWaitMs })
  if (first.ok) return first

  // One fresh commit+reveal for transient oracle Secp / gateway failures before refund.
  if (!isRetryableVrfRevealError(first.error)) {
    return first
  }

  await updatePackOpen(openId, {
    open_vrf_status: 'pending',
    open_vrf_error: `Retrying with fresh Switchboard commit after: ${first.error}`,
  } as Parameters<typeof updatePackOpen>[1])

  const second = await commitAndRevealOnce({ openId, revealWaitMs: attemptWaitMs })
  if (second.ok) return second

  // Prefer the second attempt's error (fresher), keep audit trail of first account in message.
  const combined = second.error
    ? `${second.error} (after recommit; prior: ${first.randomnessAccount ?? 'none'})`
    : first.error
  await updatePackOpen(openId, {
    open_vrf_status: 'failed',
    open_vrf_error: combined,
  } as Parameters<typeof updatePackOpen>[1])
  return {
    ok: false,
    error: combined,
    requestTx: second.requestTx ?? first.requestTx,
    randomnessAccount: second.randomnessAccount ?? first.randomnessAccount,
  }
}
