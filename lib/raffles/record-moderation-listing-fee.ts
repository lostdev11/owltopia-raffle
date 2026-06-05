import type { Raffle } from '@/lib/types'
import { updateRaffle } from '@/lib/db/raffles'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { verifyCreationFeeTransaction } from '@/lib/verify-creation-fee'
import {
  raffleModerationListingFeePaid,
  raffleRequiresModerationListingFee,
} from '@/lib/raffles/creator-moderation-policy'
import { maybePublishRaffleAfterDeposits } from '@/lib/raffles/publish-after-deposits'

export type RecordModerationListingFeeResult =
  | {
      ok: true
      alreadyRecorded: boolean
      feeRecorded: boolean
      published: boolean
    }
  | {
      ok: false
      status: number
      error: string
      feeLamports?: number
      treasury?: string | null
    }

export async function isModerationListingFeeTxUsedElsewhere(
  signature: string,
  excludeRaffleId: string
): Promise<boolean> {
  const sig = signature.trim()
  if (!sig) return false
  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .select('id')
    .eq('moderation_listing_fee_payment_tx', sig)
    .neq('id', excludeRaffleId)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[record-moderation-listing-fee] duplicate tx check', error)
    return true
  }
  return !!data
}

export async function recordModerationListingFeePayment(params: {
  raffleId: string
  raffle: Raffle
  creatorWallet: string
  feeTransactionSignature: string
}): Promise<RecordModerationListingFeeResult> {
  const { raffleId, raffle, creatorWallet } = params
  const feeTransactionSignature = params.feeTransactionSignature.trim()
  if (!feeTransactionSignature) {
    return { ok: false, status: 400, error: 'feeTransactionSignature is required' }
  }

  if (!raffle.creator_restricted_listing) {
    return { ok: false, status: 400, error: 'This raffle does not require a moderation listing deposit.' }
  }

  const requiredLamports = raffle.moderation_listing_fee_lamports ?? 0
  if (requiredLamports <= 0) {
    return { ok: false, status: 400, error: 'No moderation listing deposit is configured for this raffle.' }
  }

  if (raffleModerationListingFeePaid(raffle)) {
    const sameTx =
      (raffle.moderation_listing_fee_payment_tx ?? '').trim() === feeTransactionSignature
    if (sameTx) {
      const published = await maybePublishRaffleAfterDeposits(raffleId)
      return { ok: true, alreadyRecorded: true, feeRecorded: true, published }
    }
    return { ok: false, status: 400, error: 'Moderation listing deposit was already recorded for this raffle.' }
  }

  const treasury = getRaffleTreasuryWalletAddress()
  if (!treasury) {
    return {
      ok: false,
      status: 500,
      error: 'Treasury wallet is not configured. Set RAFFLE_RECIPIENT_WALLET.',
    }
  }

  if (await isModerationListingFeeTxUsedElsewhere(feeTransactionSignature, raffleId)) {
    return {
      ok: false,
      status: 400,
      error: 'This transaction was already used for a moderation listing deposit.',
    }
  }

  const v = await verifyCreationFeeTransaction(
    feeTransactionSignature,
    creatorWallet,
    treasury,
    requiredLamports
  )
  if (!v.valid) {
    return {
      ok: false,
      status: 400,
      error: v.error ?? 'Could not verify moderation listing deposit transaction.',
      feeLamports: requiredLamports,
      treasury,
    }
  }

  const nowIso = new Date().toISOString()
  await updateRaffle(raffleId, {
    moderation_listing_fee_paid_at: nowIso,
    moderation_listing_fee_payment_tx: feeTransactionSignature,
  })

  const published = await maybePublishRaffleAfterDeposits(raffleId)
  return { ok: true, alreadyRecorded: false, feeRecorded: true, published }
}

export async function raffleHasPendingModerationListingFee(raffle: Raffle): Promise<boolean> {
  return raffleRequiresModerationListingFee(raffle)
}
