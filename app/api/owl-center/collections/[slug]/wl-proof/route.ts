import { NextRequest, NextResponse } from 'next/server'
import { getMerkleProof } from '@metaplex-foundation/mpl-core-candy-machine'
import { getMerkleProof as getTmMerkleProof } from '@metaplex-foundation/mpl-candy-machine'
import bs58 from 'bs58'

import { listPartnerPhaseMerkleWallets, partnerPhaseMerkleRootBase58 } from '@/lib/owl-center/partner-wl-merkle'
import { normalizePhaseKey } from '@/lib/owl-center/partner-allowlist-phases'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { parseOwlCenterCollectionSlugParam } from '@/lib/owl-center/launch-slug'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 30_000
const cache = new Map<string, { wallets: string[]; at: number }>()

async function getPhaseWallets(launchId: string, phaseKey: string): Promise<string[]> {
  const key = `${launchId}:${phaseKey}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.wallets
  const wallets = await listPartnerPhaseMerkleWallets(launchId, phaseKey)
  cache.set(key, { wallets, at: Date.now() })
  return wallets
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-partner-wl-proof:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug: raw } = await context.params
  const slug = parseOwlCenterCollectionSlugParam(raw)
  if (!slug) return NextResponse.json({ error: 'Invalid collection slug' }, { status: 400 })

  const launch = await getOwlCenterLaunchBySlugAdmin(slug)
  if (!launch || launch.mint_mode !== 'public_simple') {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  const phaseKey = normalizePhaseKey(request.nextUrl.searchParams.get('phase_key') ?? 'wl') || 'wl'
  const wallets = await getPhaseWallets(launch.id, phaseKey)
  if (wallets.length === 0) {
    return NextResponse.json({ error: 'Allowlist is empty for this phase — add wallets first' }, { status: 404 })
  }

  const mintStandard = launch.mint_standard === 'core' ? 'core' : 'token_metadata'
  const merkleRoot = partnerPhaseMerkleRootBase58(wallets, mintStandard)

  const walletRaw = request.nextUrl.searchParams.get('wallet')?.trim()
  if (!walletRaw) {
    return NextResponse.json({ phase_key: phaseKey, merkle_root: merkleRoot, count: wallets.length })
  }

  const wallet = normalizeSolanaWalletAddress(walletRaw)
  if (!wallet) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  if (!wallets.includes(wallet)) {
    return NextResponse.json({ error: 'Wallet not on this phase allowlist' }, { status: 404 })
  }

  const proof =
    mintStandard === 'core'
      ? getMerkleProof(wallets, wallet).map((p) => bs58.encode(p))
      : getTmMerkleProof(wallets, wallet).map((p) => bs58.encode(p))

  return NextResponse.json({
    phase_key: phaseKey,
    merkle_root: merkleRoot,
    proof,
  })
}
