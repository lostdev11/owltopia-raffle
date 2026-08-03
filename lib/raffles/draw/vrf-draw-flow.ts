/**
 * Orchestrate Switchboard VRF request/reveal for a raffle draw.
 * Freezes ledger fields before commit; admin retry must reuse the same ledger
 * once randomness is on-chain. Pre-chain failures may refresh the ledger.
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
import { DRAW_ALGO_V3_VRF } from '@/lib/raffles/draw/types'
import type { DrawEntryLike } from '@/lib/raffles/draw/types'
import type { Raffle } from '@/lib/types'

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
  const { raffle, entries, forceNewRequest = false, revealWaitMs } = params
  const raffleId = raffle.id

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
  const canResume =
    !forceNewRequest &&
    existingAccount &&
    (existingStatus === 'pending' || existingStatus === 'failed')

  if (!canResume) {
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
      maxWaitMs: revealWaitMs,
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

    await deleteRaffleDrawSecret(raffleId)
    await patchVrfFields(raffleId, {
      draw_vrf_status: 'fulfilled',
      draw_vrf_fulfill_tx: reveal.revealTx,
      draw_vrf_fulfilled_at: new Date().toISOString(),
      draw_vrf_error: null,
    })

    return {
      status: 'fulfilled',
      drawSeed: reveal.drawSeed,
      ledgerHash,
      soldCount,
      fulfillTx: reveal.revealTx,
      requestTx: commit.commitTx,
      randomnessAccount: commit.randomnessAccount,
    }
  }

  // Resume pending/failed reveal
  const stored = await getRaffleDrawSecret(raffleId)
  const secret = parseVrfAccountSecret(stored)
  if (!secret) {
    await patchVrfFields(raffleId, {
      draw_vrf_status: 'failed',
      draw_vrf_error: 'Missing VRF account secret for pending request — use admin retry',
    })
    return {
      status: 'failed',
      error: 'Missing VRF account secret for pending request — use admin retry',
      ledgerHash,
      soldCount,
      requestTx: raffle.draw_vrf_request_tx,
      randomnessAccount: existingAccount,
    }
  }

  const reveal = await switchboardRevealRandomness({
    randomnessAccount: existingAccount,
    randomnessSecretKeyBase58: secret,
    maxWaitMs: revealWaitMs,
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
      requestTx: raffle.draw_vrf_request_tx,
      randomnessAccount: existingAccount,
    }
  }

  await deleteRaffleDrawSecret(raffleId)
  await patchVrfFields(raffleId, {
    draw_vrf_status: 'fulfilled',
    draw_vrf_fulfill_tx: reveal.revealTx,
    draw_vrf_fulfilled_at: new Date().toISOString(),
    draw_vrf_error: null,
  })

  return {
    status: 'fulfilled',
    drawSeed: reveal.drawSeed,
    ledgerHash,
    soldCount,
    fulfillTx: reveal.revealTx,
    requestTx: (raffle.draw_vrf_request_tx ?? '').trim() || '',
    randomnessAccount: existingAccount,
  }
}
