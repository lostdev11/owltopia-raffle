import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { ensureMarketplaceRow } from '@/lib/db/owl-center-marketplace'
import { upsertAssetPackageForLaunch } from '@/lib/db/owl-center-asset-package'
import {
  getOwlCenterLaunchBySlugAdmin,
  insertOwlCenterLaunchAdmin,
} from '@/lib/db/owl-center-launch'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_launches').select('*').order('updated_at', { ascending: false })
  if (error) return jsonError('Load failed', 500)

  return NextResponse.json({ launches: data ?? [] })
}

export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-launch-create:${ip}`, 20, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
  const supply = Number(body.total_supply)

  if (!SLUG_RE.test(slug) || slug === 'gen2') return jsonError('Invalid slug (lowercase a-z0-9, no gen2)', 400)
  if (!name || name.length > 120) return jsonError('Invalid name', 400)
  if (!symbol || symbol.length > 16) return jsonError('Invalid symbol', 400)
  if (!Number.isInteger(supply) || supply < 1 || supply > 50_000) return jsonError('Invalid total supply', 400)

  const existing = await getOwlCenterLaunchBySlugAdmin(slug)
  if (existing) return jsonError('Slug already exists', 409)

  const mintNetwork =
    body.mint_network === 'devnet' || body.mint_network === 'mainnet' ? body.mint_network : 'mainnet'

  const walletLimit = Number(body.wallet_mint_limit)
  const launch = await insertOwlCenterLaunchAdmin({
    slug,
    name,
    symbol,
    description: typeof body.description === 'string' ? body.description.slice(0, 4000) : null,
    image_url: typeof body.image_url === 'string' ? body.image_url.trim().slice(0, 2000) : null,
    creator_wallet:
      typeof body.creator_wallet === 'string'
        ? normalizeSolanaWalletAddress(body.creator_wallet.trim()) ?? undefined
        : undefined,
    total_supply: supply,
    public_supply: supply,
    wallet_mint_limit: Number.isInteger(walletLimit) && walletLimit >= 1 ? walletLimit : 5,
    public_price_usdc: body.public_price_usdc != null ? Number(body.public_price_usdc) : null,
    mint_mode: 'public_simple',
    mint_network: mintNetwork,
    active_phase: 'PUBLIC',
    status: 'PUBLIC',
    candy_machine_id: typeof body.candy_machine_id === 'string' ? body.candy_machine_id.trim() : null,
    collection_mint: typeof body.collection_mint === 'string' ? body.collection_mint.trim() : null,
    devnet_candy_machine_id:
      typeof body.devnet_candy_machine_id === 'string' ? body.devnet_candy_machine_id.trim() : null,
    devnet_collection_mint:
      typeof body.devnet_collection_mint === 'string' ? body.devnet_collection_mint.trim() : null,
    is_featured: Boolean(body.is_featured),
  })

  if (!launch) return jsonError('Create failed', 500)

  await Promise.all([
    upsertAssetPackageForLaunch(launch.id, { expected_supply: supply }),
    ensureMarketplaceRow(launch.id),
  ])

  return NextResponse.json({ ok: true, launch })
}
