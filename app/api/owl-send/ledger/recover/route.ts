import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import {
  getOwlSendLedgerByTxSignature,
  insertOwlSendLedgerRow,
} from '@/lib/db/owl-send-ledger'
import { recoverOwlSendLedgerDraftFromSignature } from '@/lib/owl-send/recover-ledger-tx'
import { verifyOwlSendLedgerTx } from '@/lib/owl-send/verify-ledger-tx'
import {
  describeInvalidSolanaTxSignatureInput,
  isValidSolanaTxSignatureBase58,
  normalizeDepositTxSignatureInput,
} from '@/lib/raffles/verify-prize-deposit-client'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

function requireConnectedMatchesSession(
  request: NextRequest,
  sessionWallet: string
): NextResponse | null {
  const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
  if (!connected || connected !== sessionWallet) {
    return NextResponse.json(
      { error: 'Connected wallet does not match session. Sign in with this wallet.' },
      { status: 401 }
    )
  }
  return null
}

/**
 * POST /api/owl-send/ledger/recover
 * Rebuild + insert a ledger row from a confirmed OwlSend tx signature
 * (SIWS session wallet must be the fee payer). Idempotent on tx_signature.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const ip = getClientIp(request)
    const rlIp = rateLimit(`owl-send-ledger-recover:ip:${ip}`, 20, 60_000)
    if (!rlIp.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const rlWallet = rateLimit(`owl-send-ledger-recover:w:${session.wallet}`, 10, 60_000)
    if (!rlWallet.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const txSignature = normalizeDepositTxSignatureInput(
      typeof body.txSignature === 'string' ? body.txSignature : ''
    )
    if (!isValidSolanaTxSignatureBase58(txSignature)) {
      return NextResponse.json(
        {
          error:
            describeInvalidSolanaTxSignatureInput(
              typeof body.txSignature === 'string' ? body.txSignature : ''
            ) || 'txSignature required',
        },
        { status: 400 }
      )
    }
    try {
      // eslint-disable-next-line no-new
      new PublicKey(session.wallet)
    } catch {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 400 })
    }

    const existing = await getOwlSendLedgerByTxSignature(txSignature)
    if (existing) {
      if (existing.from_wallet === session.wallet) {
        return NextResponse.json({ ok: true, duplicate: true, send: existing })
      }
      return NextResponse.json(
        { error: 'Transaction already recorded under another wallet.' },
        { status: 409 }
      )
    }

    const recovered = await recoverOwlSendLedgerDraftFromSignature({
      signature: txSignature,
      fromWallet: session.wallet,
    })
    if (!recovered.ok) {
      return NextResponse.json({ error: recovered.error }, { status: 400 })
    }

    const { draft } = recovered
    const verified = await verifyOwlSendLedgerTx({
      signature: txSignature,
      fromWallet: session.wallet,
      lines: draft.lines,
      feeLamports: draft.feeLamports,
    })
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: 400 })
    }

    const recipientCount = new Set(draft.lines.map((l) => l.recipient)).size
    const assetCount = draft.lines.length

    const result = await insertOwlSendLedgerRow({
      fromWallet: session.wallet,
      mode: draft.mode,
      assetKind: draft.assetKind,
      txSignature,
      recipientCount,
      assetCount,
      feeLamports: draft.feeLamports > 0 ? draft.feeLamports : null,
      batchIndex: null,
      lines: draft.lines,
    })

    if (!result.ok) {
      if (result.duplicate) {
        const row = await getOwlSendLedgerByTxSignature(txSignature)
        if (row?.from_wallet === session.wallet) {
          return NextResponse.json({ ok: true, duplicate: true, send: row })
        }
        return NextResponse.json(
          { error: 'Transaction already recorded under another wallet.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ ok: true, send: result.row, recovered: true })
  } catch (e) {
    console.error('owl-send ledger recover POST', e)
    return NextResponse.json({ error: 'Failed to recover send' }, { status: 500 })
  }
}
