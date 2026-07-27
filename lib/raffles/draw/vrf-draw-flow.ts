/**
 * Orchestrate Switchboard VRF request/reveal for a raffle draw.
 * Freezes ledger fields before commit; admin retry must reuse the same ledger.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  encodeVrfAccountSecret,
  parseVrfAccountSecret,
  upsertRaffleDrawSecret,
  getRaffleDrawSecret,
  deleteRaffleDrawSecret,
} from '@/lib/db/raffle-draw-secrets'
import { buildDrawLedger } from '@/lib/raffles/draw/ledger'
import {
  switchboardCommitRandomness,
  switchboardRevealRandomness,
  VRF_PROVIDER_SWITCHBOARD,
} from '@/lib/raffles/draw/vrf-switchboard'
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

function ledgerFromEntries(entries: DrawEntryLike[]) {
  const ledger = buildDrawLedger(entries)
  if (ledger.soldCount <= 0) {
    throw new Error('No drawable tickets')
  }
  return ledger
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

  // Prefer frozen ledger from a prior pending attempt (second-round safe: sales already closed at draw time).
  let soldCount = raffle.draw_sold_count ?? null
  let ledgerHash = (raffle.draw_ledger_hash ?? '').trim().toLowerCase() || null

  if (soldCount == null || !ledgerHash) {
    const ledger = ledgerFromEntries(entries)
    soldCount = ledger.soldCount
    ledgerHash = ledger.ledgerHash
  } else {
    // Sanity: frozen ledger should still match current entries when retrying.
    const live = ledgerFromEntries(entries)
    if (live.ledgerHash !== ledgerHash || live.soldCount !== soldCount) {
      return {
        status: 'failed',
        error:
          'Frozen draw ledger no longer matches confirmed entries — refusing VRF (ticket set changed).',
        ledgerHash,
        soldCount,
        requestTx: raffle.draw_vrf_request_tx,
        randomnessAccount: raffle.draw_vrf_account,
      }
    }
  }

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
