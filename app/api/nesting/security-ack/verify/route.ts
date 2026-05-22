import { NextRequest, NextResponse } from 'next/server'

import { verifyNestingSecurityAckSignature } from '@/lib/nesting/security-ack-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * POST /api/nesting/security-ack/verify
 * Body: { wallet, message, signature } — signature is base64 from signMessage.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`nesting-ack-verify:ip:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as {
      wallet?: string
      message?: string
      signature?: string
    } | null

    const wallet = normalizeSolanaWalletAddress(body?.wallet?.trim() ?? '')
    const message = typeof body?.message === 'string' ? body.message : ''
    const signature = typeof body?.signature === 'string' ? body.signature.trim() : ''

    if (!wallet || !message || !signature) {
      return NextResponse.json({ error: 'wallet, message, and signature are required' }, { status: 400 })
    }

    const walletRl = rateLimit(`nesting-ack-verify:wallet:${wallet}`, 15, 60_000)
    if (!walletRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const result = verifyNestingSecurityAckSignature(wallet, message, signature)
    if (!result.valid) {
      return NextResponse.json({ error: result.error ?? 'Invalid signature' }, { status: 401 })
    }

    return NextResponse.json({ ok: true, wallet })
  } catch (e) {
    console.error('[nesting/security-ack/verify]', e)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
