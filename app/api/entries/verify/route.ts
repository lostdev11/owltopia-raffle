import { NextRequest, NextResponse } from 'next/server'
import {
  getEntryById,
  confirmEntryWithTx,
  updateEntryStatus,
  TxAlreadyUsedError,
  InsufficientTicketsError,
  ConfirmEntryInvalidStateError,
  TransactionSignatureAlreadyUsedError,
  ComplimentaryQuotaExceededError,
  saveTransactionSignature,
  attachEntryPaymentSignature,
} from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import {
  isDefinitiveOnChainFailure,
  isTemporaryVerificationError,
} from '@/lib/entries/verification-errors'
import { verifyTransaction } from '@/lib/verify-transaction'
import { entriesVerifyBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { tryIssueReferralRewardsOnPaidEntryConfirm } from '@/lib/referrals/reward-engine'
import { isReferralGrowthProgramActive } from '@/lib/referrals/config'
import {
  tryAcquireVerificationLock,
  releaseVerificationLock,
} from '@/lib/verify-in-flight'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

// Single generic error for all failures — no signal to attackers (rate limit, state, etc.)
const ERROR_BODY = { success: false as const, error: 'server error' }

// Stricter limits so bursts cannot bypass: 40/min per IP, 5/min per wallet
const VERIFY_IP_LIMIT = 40
const VERIFY_WALLET_LIMIT = 5
const VERIFY_WINDOW_MS = 60_000

/**
 * Server-side payment verification endpoint.
 * Validates blockchain transaction first (finalized, destination, amount, sender),
 * then atomically confirms entry via RPC (lock, verified_transactions, max_tickets, update).
 * Idempotent: same entry + same tx already confirmed → 200 success.
 * Responses are minimal and non-informative to prevent exploit reconnaissance.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const ipRl = rateLimit(`entries-verify:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(entriesVerifyBody, body)
    if (!parsed.ok) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    const { entryId, transactionSignature } = parsed.data

    const entry = await getEntryById(entryId)
    if (!entry) {
      return NextResponse.json(ERROR_BODY, { status: 404 })
    }

    if (entry.referral_complimentary && Number(entry.amount_paid) === 0) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const walletRl = rateLimit(
      `entries-verify:wallet:${entry.wallet_address}`,
      VERIFY_WALLET_LIMIT,
      VERIFY_WINDOW_MS
    )
    if (!walletRl.allowed) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    if (entry.status === 'confirmed') {
      const sig = (entry.transaction_signature || '').trim()
      if (sig && sig === transactionSignature.trim()) {
        return NextResponse.json({
          success: true,
          entryId: entry.id,
          transactionSignature: sig,
        })
      }
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    // Sequential processing: only one verify per entryId at a time (reject duplicates)
    if (!tryAcquireVerificationLock(entryId)) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    try {
      let activeEntry = entry
      if (entry.status === 'rejected') {
        const reattached = await attachEntryPaymentSignature(
          entryId,
          entry.wallet_address,
          transactionSignature
        )
        if (!reattached) {
          return NextResponse.json(ERROR_BODY, { status: 400 })
        }
        activeEntry = reattached
      } else if (entry.status !== 'pending') {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      } else {
        try {
          const withSig = await saveTransactionSignature(entryId, transactionSignature)
          if (withSig) activeEntry = withSig
        } catch (err) {
          if (err instanceof TransactionSignatureAlreadyUsedError) {
            return NextResponse.json(ERROR_BODY, { status: 400 })
          }
          console.error(`Error saving transaction signature for entry ${entryId}:`, err)
        }
      }

      const raffle = await getRaffleById(activeEntry.raffle_id)
      if (!raffle) {
        return NextResponse.json(ERROR_BODY, { status: 404 })
      }

      // --- 1) Validate blockchain transaction FIRST (no DB write until verified) ---
      const verificationResult = await verifyTransaction(
        transactionSignature,
        activeEntry,
        raffle
      )

      if (!verificationResult.valid) {
        const err = verificationResult.error || ''

        // For temporary errors, keep the entry pending and signal 202 so the
        // client can show a "verifying" state and retry later.
        if (isTemporaryVerificationError(err)) {
          console.log(`Verification failed temporarily for entry ${entryId}. Error: ${err}`)
          try {
            await saveTransactionSignature(entryId, transactionSignature)
          } catch (saveErr) {
            console.error(
              `Error saving transaction signature for entry ${entryId} (temporary):`,
              saveErr
            )
          }
          return NextResponse.json(ERROR_BODY, { status: 202 })
        }

        try {
          await saveTransactionSignature(entryId, transactionSignature)
        } catch (saveErr) {
          console.error(
            `Error saving transaction signature for entry ${entryId} during failed verification:`,
            saveErr
          )
        }

        if (isDefinitiveOnChainFailure(err)) {
          try {
            await updateEntryStatus(entryId, 'rejected', transactionSignature)
            console.log(`Rejected entry ${entryId}: on-chain tx failed (${err.slice(0, 160)})`)
          } catch (rejectErr) {
            console.error(`Error rejecting entry ${entryId} after on-chain failure:`, rejectErr)
          }
          return NextResponse.json(ERROR_BODY, { status: 400 })
        }

        // Other non-temporary failures (amount mismatch, etc.) — keep pending for admin review.
        return NextResponse.json(ERROR_BODY, { status: 202 })
      }

      // --- 2) Atomic RPC: lock raffle + entry, verified_transactions, max_tickets, update entry ---
      // Entry is only "released" (lock removed) after this completes — reset-after-verify ordering
      const result = await confirmEntryWithTx(
        entryId,
        activeEntry.raffle_id,
        activeEntry.wallet_address,
        transactionSignature,
        Number(activeEntry.amount_paid),
        activeEntry.ticket_quantity
      )

      try {
        const raffleForUnlock = await getRaffleById(activeEntry.raffle_id)
        if (raffleForUnlock) {
          const allEntries = await getEntriesByRaffleId(activeEntry.raffle_id)
          const { syncMilestoneUnlocksForRaffle } = await import('@/lib/raffles/milestones/unlock')
          await syncMilestoneUnlocksForRaffle(raffleForUnlock, allEntries)
        }
      } catch (unlockErr) {
        console.error('[entries/verify] milestone unlock sync:', unlockErr)
      }

      let freeEntryUnlocked = false
      if (await isReferralGrowthProgramActive()) {
        try {
          const unlock = await tryIssueReferralRewardsOnPaidEntryConfirm(result.entry)
          freeEntryUnlocked = Boolean(unlock.buyerReward)
        } catch (rewardErr) {
          console.error('[entries/verify] referral rewards:', rewardErr)
        }
      }

      return NextResponse.json({
        success: true,
        entryId: result.entry.id,
        transactionSignature: result.entry.transaction_signature ?? transactionSignature,
        ...(freeEntryUnlocked ? { freeEntryUnlocked: true as const } : {}),
      })
    } finally {
      releaseVerificationLock(entryId)
    }
  } catch (error) {
    if (
      error instanceof TxAlreadyUsedError ||
      error instanceof TransactionSignatureAlreadyUsedError
    ) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    if (error instanceof InsufficientTicketsError) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    if (error instanceof ConfirmEntryInvalidStateError) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    if (error instanceof ComplimentaryQuotaExceededError) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    console.error('Error verifying entry:', error)
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
