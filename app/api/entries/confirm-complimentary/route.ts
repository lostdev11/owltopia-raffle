import { NextRequest, NextResponse } from 'next/server'
import { parseOr400, entriesConfirmComplimentaryBody } from '@/lib/validations'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import {
  getEntryById,
  confirmComplimentaryReferralEntry,
  ConfirmEntryInvalidStateError,
  ComplimentaryQuotaExceededError,
  InsufficientTicketsError,
  TxAlreadyUsedError,
} from '@/lib/db/entries'
import { isReferralAttributionEnabled, isReferralComplimentaryTicketEnabled } from '@/lib/referrals/config'
import {
  tryAcquireVerificationLock,
  releaseVerificationLock,
} from '@/lib/verify-in-flight'

export const dynamic = 'force-dynamic'

const ERROR_BODY = { success: false as const, error: 'server error' }

const IP_LIMIT = 30
const WINDOW_MS = 60_000

/**
 * POST /api/entries/confirm-complimentary
 * Confirms a referral complimentary ticket (amount_paid 0) using the one-time token from create.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isReferralAttributionEnabled() || !isReferralComplimentaryTicketEnabled()) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const ip = getClientIp(request)
    const ipRl = rateLimit(`entries-confirm-comp:ip:${ip}`, IP_LIMIT, WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(entriesConfirmComplimentaryBody, body)
    if (!parsed.ok) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    const { entryId, token, walletAddress } = parsed.data

    const walletRl = rateLimit(`entries-confirm-comp:wallet:${walletAddress}`, 10, WINDOW_MS)
    if (!walletRl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const entry = await getEntryById(entryId)
    if (!entry || entry.wallet_address.trim() !== walletAddress.trim()) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (!tryAcquireVerificationLock(entryId)) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '10' } })
    }

    try {
      const result = await confirmComplimentaryReferralEntry(entryId, token)
      return NextResponse.json({
        success: true,
        entryId: result.entry.id,
        transactionSignature: result.entry.transaction_signature,
      })
    } catch (e) {
      if (e instanceof ComplimentaryQuotaExceededError) {
        return NextResponse.json(
          {
            success: false as const,
            error:
              'You already used your one-time free referral ticket. You can still enter raffles by paying for tickets.',
          },
          { status: 400 }
        )
      }
      if (
        e instanceof TxAlreadyUsedError ||
        e instanceof InsufficientTicketsError ||
        e instanceof ConfirmEntryInvalidStateError
      ) {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }
      console.error('[entries/confirm-complimentary]', e instanceof Error ? e.message : e)
      return NextResponse.json(ERROR_BODY, { status: 500 })
    } finally {
      releaseVerificationLock(entryId)
    }
  } catch (e) {
    console.error('[entries/confirm-complimentary]', e instanceof Error ? e.message : e)
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
