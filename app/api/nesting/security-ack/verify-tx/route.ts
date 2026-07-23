import { NextRequest, NextResponse } from 'next/server'

import { verifyNestingSecurityAckMemoTransaction } from '@/lib/nesting/security-ack-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/nesting/security-ack/verify-tx
 * Body: { wallet, message, signedTransaction } — Ledger / hardware fallback when
 * Phantom/Solflare Sign Message never reaches the device (error Code 1 / 0x6a81).
 * The memo transaction is verified locally and is not broadcast.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`nesting-ack-verify-tx:ip:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as {
      wallet?: string
      message?: string
      signedTransaction?: string
    } | null

    const wallet = normalizeSolanaWalletAddress(body?.wallet?.trim() ?? '')
    const message = typeof body?.message === 'string' ? body.message : ''
    const signedTransaction =
      typeof body?.signedTransaction === 'string' ? body.signedTransaction.trim() : ''

    if (!wallet || !message || !signedTransaction) {
      return NextResponse.json(
        { error: 'wallet, message, and signedTransaction are required' },
        { status: 400 }
      )
    }

    const walletRl = rateLimit(`nesting-ack-verify-tx:wallet:${wallet}`, 15, 60_000)
    if (!walletRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const result = verifyNestingSecurityAckMemoTransaction(wallet, message, signedTransaction)
    if (!result.valid) {
      console.warn('[nesting/security-ack/verify-tx] reject:', result.error, {
        walletPrefix: wallet.slice(0, 4),
        txBytes: Buffer.from(signedTransaction, 'base64').length,
        messageBytes: Buffer.byteLength(message, 'utf8'),
      })
      return NextResponse.json(
        { error: result.error ?? 'Invalid signed transaction', code: 'verify_tx_failed' },
        { status: 401 }
      )
    }

    return NextResponse.json({ ok: true, wallet, method: 'tx-memo' })
  } catch (e) {
    console.error('[nesting/security-ack/verify-tx]', e)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
