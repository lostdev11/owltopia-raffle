import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { resolveWalletCluster } from '@/lib/wallet-cluster'
import { buildWalletLinkMessage, generateWalletLinkNonce } from '@/lib/wallet-link-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * GET /api/me/wallet-links/challenge?linked_wallet=...
 * Returns a message the linked wallet must sign (while signed in as primary).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`wallet-link-challenge:${session.wallet}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const cluster = await resolveWalletCluster(session.wallet)
    if (!cluster) {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
    }

    if (!cluster.is_primary) {
      return NextResponse.json(
        {
          error: 'Sign in with your primary wallet to link additional wallets.',
          code: 'not_primary',
          primary_wallet: cluster.primary_wallet,
        },
        { status: 403 }
      )
    }

    const linkedRaw = request.nextUrl.searchParams.get('linked_wallet')?.trim() ?? ''
    const linked = normalizeSolanaWalletAddress(linkedRaw)
    if (!linked) {
      return NextResponse.json({ error: 'Valid linked_wallet query param required' }, { status: 400 })
    }

    if (walletsEqualSolana(linked, cluster.primary_wallet)) {
      return NextResponse.json({ error: 'Cannot link the primary wallet to itself' }, { status: 400 })
    }

    const already = cluster.linked_wallets.some((r) => walletsEqualSolana(r.linked_wallet, linked))
    if (already) {
      return NextResponse.json({ error: 'Wallet is already linked' }, { status: 409 })
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const nonce = generateWalletLinkNonce(cluster.primary_wallet, linked)
    const message = buildWalletLinkMessage(cluster.primary_wallet, linked, nonce, expiresAt)

    return NextResponse.json({
      primary_wallet: cluster.primary_wallet,
      linked_wallet: linked,
      message,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (e) {
    console.error('[me/wallet-links/challenge]', e)
    return NextResponse.json({ error: 'Failed to create link challenge' }, { status: 500 })
  }
}
