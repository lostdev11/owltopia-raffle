/**
 * Orchestrate Switchboard VRF request/reveal for a raffle draw.
 * Freezes ledger fields before commit; admin retry must reuse the same ledger
 * once randomness is on-chain. Pre-chain failures may refresh the ledger.
 *
 * Resilience: Switchboard oracle gateways sometimes return 503 during reveal.
 * We resume pending accounts first; when a prior attempt already failed with a
 * transient gateway/timeout error we do a short on-chain check then re-commit
 * against the frozen ledger so cron recovers without an admin babysit.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  encodeVrfAccountSecret,
  parseVrfAccountSecret,
  upsertRaffleDrawSecret,
  getRaffleDrawSecret,
  deleteRaffleDrawSecret,
} from '@/lib/db/raffle-draw-secrets'
import {
  switchboardCommitRandomness,
  switchboardRevealRandomness,
  VRF_PROVIDER_SWITCHBOARD,
} from '@/lib/raffles/draw/vrf-switchboard'
import { resolveVrfDrawLedger } from '@/lib/raffles/draw/vrf-ledger'
import {
  isRetryableVrfRevealError,
  resolveVrfRevealWaitMs,
  shouldAutoForceNewVrfRequest,
  ADMIN_VRF_RECOVERY_WAIT_MS,
} from '@/lib/raffles/draw/vrf-retry-policy'
import { DRAW_ALGO_V3_VRF } from '@/lib/raffles/draw/types'
import type { DrawEntryLike } from '@/lib/raffles/draw/types'
import type { Raffle } from '@/lib/types'

/** Short poll when a prior attempt already failed — mainly catches already-revealed accounts. */
const RESUME_AFTER_FAILURE_WAIT_MS = 15_000

export type VrfFlowResult =
  | {
      status: 'fulfilled'
      drawSeed: string
      ledgerHash: string
      soldCount: number
      fulfillTx: string
      requestTx: string
      randomnessAccount: string
    }
  | {
      status: 'pending' | 'failed'
      error?: string
      ledgerHash: string
      soldCount: number
      requestTx?: string | null
      randomnessAccount?: string | null
    }

async function patchVrfFields(
  raffleId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await getSupabaseAdmin().from('raffles').update(patch).eq('id', raffleId)
  if (error) {
    throw new Error(`Failed to update VRF fields: ${error.message}`)
  }
}

async function fulfillRevealedVrf(params: {
  raffleId: string
  soldCount: number
  ledgerHash: string
  randomnessAccount: string
  requestTx: string
  reveal: {
    revealTx: string
    drawSeed: string
  }
}): Promise<VrfFlowResult> {
  await deleteRaffleDrawSecret(params.raffleId)
  await patchVrfFields(params.raffleId, {
    draw_vrf_status: 'fulfilled',
    draw_vrf_fulfill_tx: params.reveal.revealTx,
    draw_vrf_fulfilled_at: new Date().toISOString(),
    draw_vrf_error: null,
  })
  return {
    status: 'fulfilled',
    drawSeed: params.reveal.drawSeed,
    ledgerHash: params.ledgerHash,
    soldCount: params.soldCount,
    fulfillTx: params.reveal.revealTx,
    requestTx: params.requestTx,
    randomnessAccount: params.randomnessAccount,
  }
}

/** Read on-chain state only — gateway 503 after reveal tx is a common false failure. */
async function tryRecoverRevealedVrf(params: {
  raffleId: string
  soldCount: number
  ledgerHash: string
  randomnessAccount: string
  randomnessSecretKeyBase58: string
  requestTx: string
  knownRevealTx?: string | null
  maxWaitMs?: number
}): Promise<VrfFlowResult | null> {
  const reveal = await switchboardRevealRandomness({
    randomnessAccount: params.randomnessAccount,
    randomnessSecretKeyBase58: params.randomnessSecretKeyBase58,
    maxWaitMs: params.maxWaitMs ?? ADMIN_VRF_RECOVERY_WAIT_MS,
    knownRevealTx: params.knownRevealTx,
  })
  if (!reveal.ok) return null
  return fulfillRevealedVrf({
    raffleId: params.raffleId,
    soldCount: params.soldCount,
    ledgerHash: params.ledgerHash,
    randomnessAccount: params.randomnessAccount,
    requestTx: params.requestTx,
    reveal,
  })
}

async function commitAndReveal(params: {
  raffleId: string
  soldCount: number
  ledgerHash: string
  revealWaitMs?: number
}): Promise<VrfFlowResult> {
  const { raffleId, soldCount, ledgerHash, revealWaitMs } = params
  const commit = await switchboardCommitRandomness()
  if (!commit.ok) {
    await patchVrfFields(raffleId, {
      draw_algo: DRAW_ALGO_V3_VRF,
      draw_sold_count: soldCount,
      draw_ledger_hash: ledgerHash,
      draw_vrf_provider: VRF_PROVIDER_SWITCHBOARD,
      draw_vrf_status: 'failed',
      draw_vrf_error: commit.error,
      draw_vrf_account: null,
      draw_vrf_request_tx: null,
      draw_vrf_fulfill_tx: null,
      draw_vrf_requested_at: new Date().toISOString(),
    })
    return {
      status: 'failed',
      error: commit.error,
      ledgerHash,
      soldCount,
    }
  }

  await upsertRaffleDrawSecret(
    raffleId,
    encodeVrfAccountSecret(commit.randomnessSecretKeyBase58)
  )
  await patchVrfFields(raffleId, {
    draw_algo: DRAW_ALGO_V3_VRF,
    draw_sold_count: soldCount,
    draw_ledger_hash: ledgerHash,
    draw_vrf_provider: VRF_PROVIDER_SWITCHBOARD,
    draw_vrf_status: 'pending',
    draw_vrf_account: commit.randomnessAccount,
    draw_vrf_request_tx: commit.commitTx,
    draw_vrf_fulfill_tx: null,
    draw_vrf_error: null,
    draw_vrf_requested_at: new Date().toISOString(),
    draw_vrf_fulfilled_at: null,
  })

  const reveal = await switchboardRevealRandomness({
    randomnessAccount: commit.randomnessAccount,
    randomnessSecretKeyBase58: commit.randomnessSecretKeyBase58,
    maxWaitMs: resolveVrfRevealWaitMs(revealWaitMs),
  })

  if (!reveal.ok) {
    await patchVrfFields(raffleId, {
      draw_vrf_status: 'failed',
      draw_vrf_error: reveal.error,
    })
    return {
      status: reveal.retryable ? 'pending' : 'failed',
      error: reveal.error,
      ledgerHash,
      soldCount,
      requestTx: commit.commitTx,
      randomnessAccount: commit.randomnessAccount,
    }
  }

  return fulfillRevealedVrf({
    raffleId,
    soldCount,
    ledgerHash,
    randomnessAccount: commit.randomnessAccount,
    requestTx: commit.commitTx,
    reveal,
  })
}

/**
 * Start or resume VRF for a raffle. Does not select the winner — caller runs performDraw + DB winner update.
 * @param forceNewRequest — admin retry: abandon pending account and commit a new one against the same frozen ledger when present.
 */
export async function runRaffleVrfFlow(params: {
  raffle: Raffle
  entries: DrawEntryLike[]
  forceNewRequest?: boolean
  revealWaitMs?: number
}): Promise<VrfFlowResult> {
  const { raffle, entries, revealWaitMs } = params
  const raffleId = raffle.id

  const autoForce = shouldAutoForceNewVrfRequest({
    drawVrfStatus: raffle.draw_vrf_status,
    drawVrfAccount: raffle.draw_vrf_account,
    drawVrfError: raffle.draw_vrf_error,
    drawVrfRequestedAt: raffle.draw_vrf_requested_at,
  })
  const forceNewRequest = params.forceNewRequest === true || autoForce

  const ledgerResolution = resolveVrfDrawLedger({
    raffle,
    entries,
    // New commit (including admin force retry after pre-chain failure) may refresh.
    allowRefreshIfNeverReachedChain: true,
  })
  if ('error' in ledgerResolution) {
    return {
      status: 'failed',
      error: ledgerResolution.error,
      ledgerHash: ledgerResolution.ledgerHash,
      soldCount: ledgerResolution.soldCount,
      requestTx: raffle.draw_vrf_request_tx,
      randomnessAccount: raffle.draw_vrf_account,
    }
  }

  const { soldCount, ledgerHash } = ledgerResolution

  const existingStatus = (raffle.draw_vrf_status ?? '').trim()
  const existingAccount = (raffle.draw_vrf_account ?? '').trim()
  const priorError = (raffle.draw_vrf_error ?? '').trim()
  const priorFailedTransient =
    existingStatus === 'failed' && isRetryableVrfRevealError(priorError)

  const canResume =
    !forceNewRequest &&
    existingAccount &&
    (existingStatus === 'pending' || existingStatus === 'failed')

  if (!canResume) {
    if (
      existingAccount &&
      (existingStatus === 'failed' || existingStatus === 'pending')
    ) {
      const stored = await getRaffleDrawSecret(raffleId)
      const secret = parseVrfAccountSecret(stored)
      if (secret) {
        const recovered = await tryRecoverRevealedVrf({
          raffleId,
          soldCount,
          ledgerHash,
          randomnessAccount: existingAccount,
          randomnessSecretKeyBase58: secret,
          requestTx: (raffle.draw_vrf_request_tx ?? '').trim(),
          knownRevealTx: raffle.draw_vrf_fulfill_tx,
        })
        if (recovered) return recovered
      }
    }
    return commitAndReveal({ raffleId, soldCount, ledgerHash, revealWaitMs })
  }

  // Resume pending/failed reveal
  const stored = await getRaffleDrawSecret(raffleId)
  const secret = parseVrfAccountSecret(stored)
  if (!secret) {
    await patchVrfFields(raffleId, {
      draw_vrf_status: 'failed',
      draw_vrf_error: 'Missing VRF account secret for pending request — use admin retry',
    })
    // Secret lost but ledger is frozen — safe to request fresh randomness.
    return commitAndReveal({ raffleId, soldCount, ledgerHash, revealWaitMs })
  }

  // After a known gateway/timeout failure, only spend a short budget checking
  // whether the account was revealed elsewhere; then re-commit in this invocation.
  const resumeWaitMs = priorFailedTransient
    ? Math.min(RESUME_AFTER_FAILURE_WAIT_MS, resolveVrfRevealWaitMs(revealWaitMs))
    : resolveVrfRevealWaitMs(revealWaitMs)

  const reveal = await switchboardRevealRandomness({
    randomnessAccount: existingAccount,
    randomnessSecretKeyBase58: secret,
    maxWaitMs: resumeWaitMs,
    knownRevealTx: raffle.draw_vrf_fulfill_tx,
  })

  if (!reveal.ok) {
    await patchVrfFields(raffleId, {
      draw_vrf_status: 'failed',
      draw_vrf_error: reveal.error,
    })

    // Only re-commit in-process when we already knew the prior attempt failed
    // (short resume budget). A first full-budget timeout must return so the next
    // cron/admin call can recover without blowing serverless maxDuration.
    if (priorFailedTransient && isRetryableVrfRevealError(reveal.error)) {
      console.warn(
        `[runRaffleVrfFlow] prior VRF failure for ${raffleId}; committing fresh VRF after short resume: ${reveal.error}`
      )
      return commitAndReveal({ raffleId, soldCount, ledgerHash, revealWaitMs })
    }

    return {
      status: reveal.retryable ? 'pending' : 'failed',
      error: reveal.error,
      ledgerHash,
      soldCount,
      requestTx: raffle.draw_vrf_request_tx,
      randomnessAccount: existingAccount,
    }
  }

  return fulfillRevealedVrf({
    raffleId,
    soldCount,
    ledgerHash,
    randomnessAccount: existingAccount,
    requestTx: (raffle.draw_vrf_request_tx ?? '').trim(),
    reveal,
  })
}
