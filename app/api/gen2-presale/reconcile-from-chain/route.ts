import { NextRequest, NextResponse } from 'next/server'

import {
  GEN2_RECONCILE_MAX_SIG_LIMIT,
  reconcileGen2PresaleWalletFromChain,
} from '@/lib/gen2-presale/reconcile-wallet-from-chain'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/gen2-presale/reconcile-from-chain
 * Body: { wallet: string, signatureLimit?: number }
 *
 * Scans recent on-chain transactions for the wallet and records any Gen2 presale payments
 * that match server verification but were missing from the database (e.g. confirm never ran).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-reconcile-wallet:${ip}`, 12, 600_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many sync requests — try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': '600' } }
      )
    }

    let body: { wallet?: string; signatureLimit?: number }
    try {
      body = (await request.json().catch(() => ({}))) as typeof body
    } catch {
      body = {}
    }

    const wallet = normalizeSolanaWalletAddress(typeof body.wallet === 'string' ? body.wallet : '')
    if (!wallet) {
      return NextResponse.json({ error: 'Invalid or missing wallet' }, { status: 400 })
    }

    let signatureLimit: number | undefined
    if (body.signatureLimit != null) {
      const n = Math.floor(Number(body.signatureLimit))
      if (Number.isFinite(n) && n >= 1) {
        signatureLimit = Math.min(GEN2_RECONCILE_MAX_SIG_LIMIT, n)
      }
    }

    const result = await reconcileGen2PresaleWalletFromChain({ wallet, signatureLimit })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('gen2-presale reconcile-from-chain:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
