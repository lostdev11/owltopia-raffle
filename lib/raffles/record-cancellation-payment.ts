import type { Raffle } from '@/lib/types'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'
import { verifyCancellationFeeTransaction } from '@/lib/verify-cancellation-fee-tx'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { updateRaffle } from '@/lib/db/raffles'

export type RecordCancellationPaymentResult =
  | {
      ok: true
      alreadyRecorded: boolean
      cancellationRequested: boolean
      feeRecorded: boolean
    }
  | {
      ok: false
      status: number
      error: string
      requiresCancellationFee?: boolean
      feeSol?: number
      treasury?: string | null
    }

export async function isCancellationFeeTxUsedElsewhere(
  signature: string,
  excludeRaffleId: string
): Promise<boolean> {
  const sig = signature.trim()
  if (!sig) return false
  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .select('id')
    .eq('cancellation_fee_payment_tx', sig)
    .neq('id', excludeRaffleId)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[record-cancellation-payment] duplicate tx check', error)
    return true
  }
  return !!data
}

function isOpenCancellationStatus(status: string | null | undefined): boolean {
  const s = (status ?? '').toLowerCase()
  return s === 'live' || s === 'ready_to_draw'
}

/**
 * Verify and persist a post-start cancellation fee (idempotent per raffle + tx signature).
 * When `openCancellationRequest` is true and the listing is still live/ready_to_draw, also sets
 * `cancellation_requested_at` so Owl Vision shows the pending admin queue row.
 */
export async function recordCancellationFeePayment(params: {
  raffleId: string
  raffle: Raffle
  creatorWallet: string
  feeTransactionSignature: string
  openCancellationRequest: boolean
}): Promise<RecordCancellationPaymentResult> {
  const { raffleId, raffle, creatorWallet, openCancellationRequest } = params
  const feeTransactionSignature = params.feeTransactionSignature.trim()
  if (!feeTransactionSignature) {
    return { ok: false, status: 400, error: 'feeTransactionSignature is required' }
  }

  const treasury = getRaffleTreasuryWalletAddress()
  const feeSol = getCancellationFeeSol()
  const needsFee = raffleRequiresCancellationFee(raffle, new Date())
  const status = raffle.status ?? ''
  const openStatus = isOpenCancellationStatus(status)

  if (openCancellationRequest && !openStatus) {
    return {
      ok: false,
      status: 400,
      error: 'Only live or ready-to-draw raffles can open a cancellation request.',
    }
  }

  if (!needsFee && openCancellationRequest) {
    return {
      ok: false,
      status: 400,
      error: 'A cancellation fee is not required for this raffle (it had not started by schedule).',
    }
  }

  const sameTxOnRaffle =
    (raffle.cancellation_fee_payment_tx ?? '').trim() === feeTransactionSignature
  const hasRequest = !!raffle.cancellation_requested_at
  const hasFee = !!raffle.cancellation_fee_paid_at

  if (sameTxOnRaffle && hasFee) {
    if (openCancellationRequest && !hasRequest && openStatus) {
      const stamp = raffle.cancellation_fee_paid_at ?? new Date().toISOString()
      await updateRaffle(raffleId, { cancellation_requested_at: stamp })
      return {
        ok: true,
        alreadyRecorded: true,
        cancellationRequested: true,
        feeRecorded: true,
      }
    }
    return {
      ok: true,
      alreadyRecorded: true,
      cancellationRequested: hasRequest,
      feeRecorded: true,
    }
  }

  if (hasRequest && hasFee && openCancellationRequest) {
    return {
      ok: true,
      alreadyRecorded: true,
      cancellationRequested: true,
      feeRecorded: true,
    }
  }

  if (!treasury) {
    return {
      ok: false,
      status: 500,
      error: 'Treasury wallet is not configured. Set RAFFLE_RECIPIENT_WALLET.',
    }
  }

  if (await isCancellationFeeTxUsedElsewhere(feeTransactionSignature, raffleId)) {
    return {
      ok: false,
      status: 400,
      error: 'This transaction was already used for a cancellation fee.',
    }
  }

  const v = await verifyCancellationFeeTransaction(
    feeTransactionSignature,
    creatorWallet,
    treasury
  )
  if (!v.valid) {
    return {
      ok: false,
      status: 400,
      error: v.error ?? 'Could not verify cancellation fee transaction.',
      requiresCancellationFee: true,
      feeSol,
      treasury,
    }
  }

  const nowIso = new Date().toISOString()
  const patch: Parameters<typeof updateRaffle>[1] = {
    cancellation_fee_paid_at: raffle.cancellation_fee_paid_at ?? nowIso,
    cancellation_fee_payment_tx: feeTransactionSignature,
  }

  let cancellationRequested = hasRequest
  if (openCancellationRequest && openStatus && !hasRequest) {
    patch.cancellation_requested_at = nowIso
    cancellationRequested = true
  }

  await updateRaffle(raffleId, patch)

  return {
    ok: true,
    alreadyRecorded: false,
    cancellationRequested,
    feeRecorded: true,
  }
}
