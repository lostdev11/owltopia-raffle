import { NextRequest, NextResponse } from 'next/server'
import {
  getEntryById,
  confirmCartBatchWithTx,
  TxAlreadyUsedError,
  TransactionSignatureAlreadyUsedError,
  InsufficientTicketsError,
  ConfirmEntryInvalidStateError,
  saveTransactionSignature,
  attachEntryPaymentSignature,
  updateEntryStatus,
} from '@/lib/db/entries'
import {
  isDefinitiveOnChainFailure,
  isTemporaryVerificationError,
} from '@/lib/entries/verification-errors'
import type { Entry, Raffle } from '@/lib/types'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { entriesVerifyBatchBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { tryAcquireVerificationLock, releaseVerificationLocks } from '@/lib/verify-in-flight'
import { verifyBatchPaidEntries } from '@/lib/verify-batch-transaction'
import type { VerifyBatchErrorCode } from '@/lib/api/verify-batch-response'

export const dynamic = 'force-dynamic'

function verifyBatchErr(code: VerifyBatchErrorCode, status: number, headers?: HeadersInit) {
  return NextResponse.json({ success: false as const, code }, { status, headers })
}

/** One cart checkout hits verify-batch once; retries + dual tabs burned the old wallet limit quickly (429 ⇒ false "confirmation failed"). */
const VERIFY_IP_LIMIT = 45
const VERIFY_WALLET_LIMIT = 24
const VERIFY_WINDOW_MS = 60_000

export async function POST(request: NextRequest) {
  const locksHeld: string[] = []
  try {
    const ip = getClientIp(request)
    const ipRl = rateLimit(`entries-verify-batch:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_WINDOW_MS)
    if (!ipRl.allowed) {
      return verifyBatchErr('rate_limited', 429, { 'Retry-After': '60' })
    }

    const rawBody = await request.json().catch(() => ({}))
    const parsed = parseOr400(entriesVerifyBatchBody, rawBody)
    if (!parsed.ok) return verifyBatchErr('invalid_request', 400)
    const { transactionSignature: transactionSignatureRaw, entryIds } = parsed.data

    const entryIdsSorted = [...new Set(entryIds)].sort()

    const pairs: { entry: Entry; raffle: Raffle }[] = []
    let walletAnchor: string | null = null

    for (const id of entryIdsSorted) {
      let entry = await getEntryById(id)
      if (!entry) return verifyBatchErr('entries_not_found', 404)

      const w = (entry.wallet_address || '').trim()
      if (!walletAnchor) walletAnchor = w
      else if (w !== walletAnchor) return verifyBatchErr('invalid_request', 400)

      const walletRl = rateLimit(`entries-verify-batch:wallet:${w}`, VERIFY_WALLET_LIMIT, VERIFY_WINDOW_MS)
      if (!walletRl.allowed) {
        return verifyBatchErr('rate_limited', 429, { 'Retry-After': '60' })
      }

      if (entry.status === 'rejected') {
        try {
          const reattached = await attachEntryPaymentSignature(
            id,
            w,
            transactionSignatureRaw
          )
          if (!reattached) return verifyBatchErr('invalid_request', 400)
          entry = reattached
        } catch (e) {
          if (e instanceof TransactionSignatureAlreadyUsedError) {
            return verifyBatchErr('invalid_request', 400)
          }
          throw e
        }
      } else if (entry.status !== 'pending') {
        if (entry.status === 'confirmed') {
          const existingSig = (entry.transaction_signature || '').trim()
          if (existingSig === transactionSignatureRaw.trim()) {
            /* idempotent — include in batch confirm path below */
          } else {
            return verifyBatchErr('invalid_request', 400)
          }
        } else {
          return verifyBatchErr('invalid_request', 400)
        }
      }

      const raffle = await getRaffleById(entry.raffle_id)
      if (!raffle) return verifyBatchErr('entries_not_found', 404)

      const qty = Number(entry.ticket_quantity)
      if (!Number.isFinite(qty) || qty < 1 || Math.floor(qty) !== qty) {
        return verifyBatchErr('invalid_request', 400)
      }

      pairs.push({ entry, raffle })
    }

    const pairsSorted = [...pairs].sort((a, b) => {
      const r = String(a.entry.raffle_id).localeCompare(String(b.entry.raffle_id))
      return r !== 0 ? r : String(a.entry.id).localeCompare(String(b.entry.id))
    })

    for (const { entry } of pairsSorted) {
      if (!tryAcquireVerificationLock(entry.id)) {
        releaseVerificationLocks(locksHeld)
        return verifyBatchErr('rate_limited', 429, { 'Retry-After': '60' })
      }
      locksHeld.push(entry.id)
    }

    try {
      const blockchain = await verifyBatchPaidEntries(transactionSignatureRaw, pairsSorted)

      if (!blockchain.valid) {
        const err = blockchain.error || ''
        console.warn('[entries/verify-batch] on-chain verify invalid', err.slice(0, 280))

        if (isTemporaryVerificationError(err)) {
          await Promise.all(
            pairsSorted.map(({ entry }) =>
              saveTransactionSignature(entry.id, transactionSignatureRaw).catch(() => {})
            )
          )
          return NextResponse.json(
            { success: true as const, pending: true as const, code: 'chain_indexing' as const },
            { status: 202 }
          )
        }

        await Promise.all(
          pairsSorted.map(({ entry }) =>
            saveTransactionSignature(entry.id, transactionSignatureRaw).catch(() => {})
          )
        )

        if (isDefinitiveOnChainFailure(err)) {
          await Promise.all(
            pairsSorted.map(({ entry }) =>
              updateEntryStatus(entry.id, 'rejected', transactionSignatureRaw).catch(rejectErr => {
                console.error(
                  `[entries/verify-batch] reject entry ${entry.id} after on-chain failure:`,
                  rejectErr
                )
              })
            )
          )
        }

        return verifyBatchErr('chain_verify_failed', 400)
      }

      /** Persist sig before DB confirm so RPC/500/confirm_failed still leaves a trail for retries & admin. */
      await Promise.all(
        pairsSorted.map(({ entry }) =>
          saveTransactionSignature(entry.id, transactionSignatureRaw).catch(() => {})
        )
      )

      try {
        await confirmCartBatchWithTx(
          pairsSorted[0]!.entry.wallet_address.trim(),
          transactionSignatureRaw,
          pairsSorted.map(p => p.entry.id)
        )
      } catch (err) {
        if (
          err instanceof TxAlreadyUsedError ||
          err instanceof TransactionSignatureAlreadyUsedError ||
          err instanceof InsufficientTicketsError ||
          err instanceof ConfirmEntryInvalidStateError
        ) {
          return verifyBatchErr('confirm_failed', 400)
        }
        const msg = err instanceof Error ? err.message : String(err)
        /** Missing migration 091, stale PostgREST schema, or RPC rename → avoid opaque 500 loops. */
        const infraRpc =
          /permission denied|does not exist|schema cache|Could not find the function|PGRST202|42883|42501|Invalid response from confirm_cart_batch_with_tx/i.test(
            msg
          )
        console.error(
          `[entries/verify-batch] confirmCartBatchWithTx ${infraRpc ? 'infra' : 'unexpected'}:`,
          msg.slice(0, 600),
          err
        )
        if (infraRpc) {
          return verifyBatchErr('server_error', 503)
        }
        return verifyBatchErr('confirm_failed', 400)
      }

      try {
        const raffleIds = [...new Set(pairsSorted.map((p) => p.entry.raffle_id))]
        const { syncMilestoneUnlocksForRaffle } = await import('@/lib/raffles/milestones/unlock')
        for (const raffleId of raffleIds) {
          const raffle = await getRaffleById(raffleId)
          if (!raffle) continue
          const allEntries = await getEntriesByRaffleId(raffleId)
          await syncMilestoneUnlocksForRaffle(raffle, allEntries)
        }
      } catch (unlockErr) {
        console.error('[entries/verify-batch] milestone unlock sync:', unlockErr)
      }

      return NextResponse.json({
        success: true,
        entryIds: pairsSorted.map(p => p.entry.id),
        transactionSignature: transactionSignatureRaw,
      })
    } finally {
      releaseVerificationLocks(locksHeld)
      locksHeld.length = 0
    }
  } catch (e) {
    console.error('[entries/verify-batch]', e)
    return verifyBatchErr('server_error', 500)
  }
}
