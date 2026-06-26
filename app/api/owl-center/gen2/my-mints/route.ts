import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { collectMintedNftMintsForWallets } from '@/lib/owl-center/hash-list'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isDevnetMintEnabled } from '@/lib/solana/network'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { resolveWalletCluster } from '@/lib/wallet-cluster'

export const dynamic = 'force-dynamic'

async function handle(wallet: string | null) {
  if (!wallet) {
    return NextResponse.json({ mints: [], network: isDevnetMintEnabled() ? 'devnet' : 'mainnet' })
  }

  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  const network = isDevnetMintEnabled() ? 'devnet' : 'mainnet'

  // Include linked cluster wallets so a user sees everything they minted, even from a wallet
  // other than the one currently connected.
  let wallets = [wallet]
  try {
    const cluster = await resolveWalletCluster(wallet)
    if (cluster?.cluster_wallets?.length) wallets = cluster.cluster_wallets
  } catch {
    /* fall back to the connected wallet only */
  }

  const mints = await collectMintedNftMintsForWallets(launch.id, wallets, network)
  return NextResponse.json({ mints, network })
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-gen2-my-mints:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let wallet: string | null = null
  try {
    const body = (await request.json()) as { wallet?: string }
    const w = body.wallet?.trim()
    wallet = w ? normalizeSolanaWalletAddress(w) ?? w : null
  } catch {
    wallet = null
  }

  return handle(wallet)
}
