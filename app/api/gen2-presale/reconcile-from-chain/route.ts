import { NextRequest, NextResponse } from 'next/server'

import { reconcileGen2PresaleWalletFromChain } from '@/lib/gen2-presale/reconcile-wallet-from-chain'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/gen2-presale/reconcile-from-chain
 * Body: { wallet: string, signatureLimit?: number, pageSize?: number, maxPages?: number }
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

    let body: { wallet?: string; signatureLimit?: number; pageSize?: number; maxPages?: number }
    try {
      body = (await request.json().catch(() => ({}))) as typeof body
    } catch {
      body = {}
    }

    const wallet = normalizeSolanaWalletAddress(typeof body.wallet === 'string' ? body.wallet : '')
    if (!wallet) {
      return NextResponse.json({ error: 'Invalid or missing wallet' }, { status: 400 })
    }

    const signatureLimit =
      body.signatureLimit != null && Number.isFinite(Number(body.signatureLimit))
        ? Math.floor(Number(body.signatureLimit))
        : undefined
    const pageSize =
      body.pageSize != null && Number.isFinite(Number(body.pageSize))
        ? Math.floor(Number(body.pageSize))
        : undefined
    const maxPages =
      body.maxPages != null && Number.isFinite(Number(body.maxPages))
        ? Math.floor(Number(body.maxPages))
        : undefined

    const result = await reconcileGen2PresaleWalletFromChain({
      wallet,
      ...(signatureLimit != null ? { signatureLimit } : {}),
      ...(pageSize != null ? { pageSize } : {}),
      ...(maxPages != null ? { maxPages } : {}),
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('gen2-presale reconcile-from-chain:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
