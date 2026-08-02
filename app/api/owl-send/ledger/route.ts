import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import {
  getOwlSendLedgerByTxSignature,
  insertOwlSendLedgerRow,
  listOwlSendLedgerForWallet,
  type OwlSendLedgerAssetKind,
  type OwlSendLedgerLine,
  type OwlSendLedgerMode,
} from '@/lib/db/owl-send-ledger'
import { verifyOwlSendLedgerTx } from '@/lib/owl-send/verify-ledger-tx'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'
const MODES = new Set<OwlSendLedgerMode>(['nft_one', 'nft_scatter', 'token_one', 'token_scatter'])
const KINDS = new Set<OwlSendLedgerAssetKind>(['nft', 'token'])

function isPubkey(s: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(s)
    return true
  } catch {
    return false
  }
}

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

/** GET /api/owl-send/ledger — session wallet only (private ledger). */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-send-ledger-get:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const requested = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    if (requested && requested !== session.wallet) {
      return NextResponse.json(
        { error: 'You can only view your own OwlSend ledger.' },
        { status: 403 }
      )
    }

    const limitRaw = Number(request.nextUrl.searchParams.get('limit') ?? '40')
    const rows = await listOwlSendLedgerForWallet({
      wallet: session.wallet,
      limit: Number.isFinite(limitRaw) ? limitRaw : 40,
    })
    return NextResponse.json({ sends: rows, wallet: session.wallet })
  } catch (e) {
    console.error('owl-send ledger GET', e)
    return NextResponse.json({ error: 'Failed to load ledger' }, { status: 500 })
  }
}

/** POST /api/owl-send/ledger — SIWS + on-chain verify, then insert (idempotent on tx_signature). */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const ip = getClientIp(request)
    const rlIp = rateLimit(`owl-send-ledger-post:ip:${ip}`, 40, 60_000)
    if (!rlIp.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const rlWallet = rateLimit(`owl-send-ledger-post:w:${session.wallet}`, 30, 60_000)
    if (!rlWallet.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const fromWallet = typeof body.fromWallet === 'string' ? body.fromWallet.trim() : ''
    const txSignature = typeof body.txSignature === 'string' ? body.txSignature.trim() : ''
    const mode = body.mode as OwlSendLedgerMode
    const assetKind = body.assetKind as OwlSendLedgerAssetKind

    if (!fromWallet || !isPubkey(fromWallet)) {
      return NextResponse.json({ error: 'fromWallet required' }, { status: 400 })
    }
    if (fromWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'fromWallet must match signed-in wallet.' },
        { status: 403 }
      )
    }
    if (!txSignature || txSignature.length < 32) {
      return NextResponse.json({ error: 'txSignature required' }, { status: 400 })
    }
    if (!MODES.has(mode) || !KINDS.has(assetKind)) {
      return NextResponse.json({ error: 'Invalid mode or assetKind' }, { status: 400 })
    }

    const linesRaw = Array.isArray(body.lines) ? body.lines : []
    const lines: OwlSendLedgerLine[] = []
    for (const item of linesRaw.slice(0, 20)) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const recipient = typeof row.recipient === 'string' ? row.recipient.trim() : ''
      const mint = typeof row.mint === 'string' ? row.mint.trim() : ''
      if (!recipient || !isPubkey(recipient) || !mint || !isPubkey(mint)) continue
      lines.push({
        recipient,
        mint,
        name: typeof row.name === 'string' ? row.name : null,
        amount_raw:
          typeof row.amount_raw === 'string' || typeof row.amount_raw === 'number'
            ? String(row.amount_raw)
            : null,
        decimals: typeof row.decimals === 'number' ? row.decimals : null,
        symbol: typeof row.symbol === 'string' ? row.symbol : null,
      })
    }
    if (lines.length < 1) {
      return NextResponse.json({ error: 'At least one valid line (recipient + mint) required' }, { status: 400 })
    }

    const feeLamports =
      typeof body.feeLamports === 'number' && Number.isFinite(body.feeLamports)
        ? Math.max(0, Math.floor(body.feeLamports))
        : null
    const batchIndex =
      typeof body.batchIndex === 'number' && Number.isFinite(body.batchIndex)
        ? Math.max(0, Math.floor(body.batchIndex))
        : null

    const verified = await verifyOwlSendLedgerTx({
      signature: txSignature,
      fromWallet: session.wallet,
      lines,
      feeLamports,
    })
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: 400 })
    }

    const recipientCount = new Set(lines.map((l) => l.recipient)).size
    const assetCount = lines.length

    const result = await insertOwlSendLedgerRow({
      fromWallet: session.wallet,
      mode,
      assetKind,
      txSignature,
      recipientCount,
      assetCount,
      feeLamports,
      batchIndex,
      lines,
    })

    if (!result.ok) {
      if (result.duplicate) {
        const existing = await getOwlSendLedgerByTxSignature(txSignature)
        if (existing?.from_wallet === session.wallet) {
          return NextResponse.json({ ok: true, duplicate: true, send: existing })
        }
        return NextResponse.json(
          { error: 'Transaction already recorded under another wallet.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json({ ok: true, send: result.row })
  } catch (e) {
    console.error('owl-send ledger POST', e)
    return NextResponse.json({ error: 'Failed to record send' }, { status: 500 })
  }
}
