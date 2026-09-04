import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isAdmin } from '@/lib/db/admins'
import { canAccessOwlSend } from '@/lib/owl-send/access'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import { prepareMplCoreTransferTransaction } from '@/lib/solana/mpl-core-transfer-prepare'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

function isPubkey(s: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(s)
    return true
  } catch {
    return false
  }
}

/**
 * POST /api/owl-send/prepare-core-transfer
 * Body: { mint, recipient, feeDiscountBps? }
 *
 * Builds an unsigned MPL Core transfer (+ Owl fee) on the server private RPC so
 * browser NetworkError / Failed to fetch does not block Core OwlSend.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (!connected || connected !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Sign in with this wallet.' },
        { status: 401 }
      )
    }

    const viewerIsAdmin = await isAdmin(session.wallet)
    if (!canAccessOwlSend({ isAdmin: viewerIsAdmin })) {
      return NextResponse.json({ error: 'OwlSend is not available for this wallet.' }, { status: 403 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-send-prepare-core:${ip}:${session.wallet}`, 40, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many prepare requests. Wait a minute and retry.' },
        { status: 429 }
      )
    }

    const body = (await request.json().catch(() => null)) as {
      mint?: unknown
      recipient?: unknown
      feeDiscountBps?: unknown
    } | null

    const mint = typeof body?.mint === 'string' ? body.mint.trim() : ''
    const recipient = typeof body?.recipient === 'string' ? body.recipient.trim() : ''
    const feeDiscountBps =
      typeof body?.feeDiscountBps === 'number' && Number.isFinite(body.feeDiscountBps)
        ? Math.max(0, Math.min(10_000, Math.floor(body.feeDiscountBps)))
        : 0

    if (!isPubkey(mint) || !isPubkey(recipient)) {
      return NextResponse.json(
        { error: 'Provide valid mint and recipient pubkeys.' },
        { status: 400 }
      )
    }

    const treasury = getPlatformFeeTreasuryWalletAddress()
    const feeLamports = getOwlSendFeeLamportsForCount(1, feeDiscountBps)
    const connection = getSolanaConnection()

    const prepared = await prepareMplCoreTransferTransaction({
      connection,
      ownerWallet: session.wallet,
      assetId: mint,
      recipient,
      feeLamports,
      feeTreasury: treasury,
    })

    return NextResponse.json({ ok: true, item: prepared, owner: session.wallet })
  } catch (e) {
    console.error('[owl-send/prepare-core-transfer]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
