import { NextRequest, NextResponse } from 'next/server'
import {
  getEntryById,
  confirmEntryWithTx,
  TxAlreadyUsedError,
  TransactionSignatureAlreadyUsedError,
  InsufficientTicketsError,
  ConfirmEntryInvalidStateError,
  saveTransactionSignature,
} from '@/lib/db/entries'
import type { Entry, Raffle } from '@/lib/types'
import { getRaffleById } from '@/lib/db/raffles'
import { entriesVerifyBatchBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { tryAcquireVerificationLock, releaseVerificationLocks } from '@/lib/verify-in-flight'
import { verifyBatchPaidEntries } from '@/lib/verify-batch-transaction'

export const dynamic = 'force-dynamic'

const ERROR_BODY = { success: false as const, error: 'server error' }

const VERIFY_IP_LIMIT = 30
const VERIFY_WALLET_LIMIT = 4
const VERIFY_WINDOW_MS = 60_000

export async function POST(request: NextRequest) {
  const locksHeld: string[] = []
  try {
    const ip = getClientIp(request)
    const ipRl = rateLimit(`entries-verify-batch:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const rawBody = await request.json().catch(() => ({}))
    const parsed = parseOr400(entriesVerifyBatchBody, rawBody)
    if (!parsed.ok) return NextResponse.json(ERROR_BODY, { status: 400 })
    const { transactionSignature: transactionSignatureRaw, entryIds } = parsed.data

    const entryIdsSorted = [...new Set(entryIds)].sort()

    const pairs: { entry: Entry; raffle: Raffle }[] = []
    let walletAnchor: string | null = null

    for (const id of entryIdsSorted) {
      const entry = await getEntryById(id)
      if (!entry) return NextResponse.json(ERROR_BODY, { status: 404 })

      const w = (entry.wallet_address || '').trim()
      if (!walletAnchor) walletAnchor = w
      else if (w !== walletAnchor) return NextResponse.json(ERROR_BODY, { status: 400 })

      const walletRl = rateLimit(`entries-verify-batch:wallet:${w}`, VERIFY_WALLET_LIMIT, VERIFY_WINDOW_MS)
      if (!walletRl.allowed) {
        return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
      }

      const raffle = await getRaffleById(entry.raffle_id)
      if (!raffle) return NextResponse.json(ERROR_BODY, { status: 404 })
      pairs.push({ entry, raffle })
    }

    const pairsSorted = [...pairs].sort((a, b) => {
      const r = String(a.entry.raffle_id).localeCompare(String(b.entry.raffle_id))
      return r !== 0 ? r : String(a.entry.id).localeCompare(String(b.entry.id))
    })

    for (const { entry } of pairsSorted) {
      if (!tryAcquireVerificationLock(entry.id)) {
        releaseVerificationLocks(locksHeld)
        return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
      }
      locksHeld.push(entry.id)
    }

    try {
      const blockchain = await verifyBatchPaidEntries(transactionSignatureRaw, pairsSorted)

      if (!blockchain.valid) {
        const err = blockchain.error || ''
        const isTemporary =
          err.includes('Transaction not found') ||
          err.includes('still be confirming') ||
          err.includes('temporary issue') ||
          err.includes('Verification error')

        if (isTemporary) {
          await Promise.all(
            pairsSorted.map(({ entry }) =>
              saveTransactionSignature(entry.id, transactionSignatureRaw).catch(() => {})
            )
          )
          return NextResponse.json(ERROR_BODY, { status: 202 })
        }

        return NextResponse.json(ERROR_BODY, { status: 400 })
      }

      try {
        for (const { entry } of pairsSorted) {
          await confirmEntryWithTx(
            entry.id,
            entry.raffle_id,
            entry.wallet_address,
            transactionSignatureRaw,
            Number(entry.amount_paid),
            entry.ticket_quantity
          )
        }
      } catch (err) {
        if (
          err instanceof TxAlreadyUsedError ||
          err instanceof TransactionSignatureAlreadyUsedError ||
          err instanceof InsufficientTicketsError ||
          err instanceof ConfirmEntryInvalidStateError
        ) {
          return NextResponse.json(ERROR_BODY, { status: 400 })
        }
        throw err
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
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
