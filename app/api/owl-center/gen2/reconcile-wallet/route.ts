import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { flushPendingGen2MintDiscordFeed } from '@/lib/owl-center/gen2-mint-discord-feed'
import { reconcileGen2WalletMints } from '@/lib/owl-center/reconcile-gen2-wallet-mints'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isDevnetMintEnabled, owlMintNetworkFromParam, type OwlMintNetwork } from '@/lib/solana/network'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Triggers a best-effort on-chain → DB reconcile for one wallet's Gen2 mints. The mint UI fires this
 * via `navigator.sendBeacon` on page unload (and as a manual fallback), so mints whose client-side
 * confirm was interrupted — the common mobile case where the page closes when the wallet returns —
 * still get recorded server-side. The reconcile itself is idempotent and drift-gated, so repeated
 * calls are cheap and safe.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-reconcile-wallet:${ip}`, 20, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { wallet?: string; network?: string }
  try {
    body = (await request.json()) as { wallet?: string; network?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const wallet = body.wallet?.trim() ? normalizeSolanaWalletAddress(body.wallet.trim()) : null
  if (!wallet) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }

  // Network is server-default-authoritative; honor an explicit valid override if provided.
  let network: OwlMintNetwork = isDevnetMintEnabled() ? 'devnet' : 'mainnet'
  const override = body.network?.trim() ? owlMintNetworkFromParam(body.network.trim()) : null
  if (override) network = override

  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  try {
    const { recorded, drift } = await reconcileGen2WalletMints({ launch, wallet, network })
    let discord_flushed = 0
    if (network === 'mainnet' && recorded > 0) {
      discord_flushed = await flushPendingGen2MintDiscordFeed({ limit: Math.min(50, recorded + 5) })
    }
    return NextResponse.json({ ok: true, recorded, drift, discord_flushed })
  } catch (e) {
    console.error('gen2 reconcile-wallet', e)
    return NextResponse.json({ ok: false, error: 'reconcile_failed' }, { status: 500 })
  }
}
