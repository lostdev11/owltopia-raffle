import { NextRequest, NextResponse } from 'next/server'
import {
  attachEntryPaymentSignature,
  TransactionSignatureAlreadyUsedError,
} from '@/lib/db/entries'
import { entriesAttachTxBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const ERROR_BODY = { success: false as const, error: 'server error' }

const ATTACH_IP_LIMIT = 60
const ATTACH_WALLET_LIMIT = 15
const WINDOW_MS = 60_000

/**
 * POST /api/entries/attach-tx
 * Save payment signature immediately after wallet send (single entry or cart batch).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const ipRl = rateLimit(`entries-attach-tx:ip:${ip}`, ATTACH_IP_LIMIT, WINDOW_MS)
    if (!ipRl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(entriesAttachTxBody, body)
    if (!parsed.ok) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const { transactionSignature, walletAddress } = parsed.data
    const entryIds = parsed.data.entryIds?.length
      ? parsed.data.entryIds
      : parsed.data.entryId
        ? [parsed.data.entryId]
        : []

    const walletRl = rateLimit(
      `entries-attach-tx:wallet:${walletAddress}`,
      ATTACH_WALLET_LIMIT,
      WINDOW_MS
    )
    if (!walletRl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const attached: string[] = []
    for (const entryId of entryIds) {
      try {
        const row = await attachEntryPaymentSignature(entryId, walletAddress, transactionSignature)
        if (row) attached.push(entryId)
      } catch (e) {
        if (e instanceof TransactionSignatureAlreadyUsedError) {
          return NextResponse.json(ERROR_BODY, { status: 400 })
        }
        throw e
      }
    }

    if (attached.length === 0) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      entryIds: attached,
      transactionSignature,
    })
  } catch (error) {
    console.error('Error attaching transaction signature:', error)
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
