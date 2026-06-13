import { NextRequest, NextResponse } from 'next/server'

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-submit:${ip}`, 8, 3600_000).allowed) {
    return NextResponse.json({ error: 'Too many submissions — try later.' }, { status: 429 })
  }

  let body: {
    collection_name?: string
    symbol?: string
    description?: string
    image_url?: string
    total_supply?: number
    mint_price?: number
    currency?: string
    wallet_mint_limit?: number
    launch_date?: string | null
    creator_wallet?: string
    treasury_wallet?: string | null
    magic_eden_url?: string | null
    tensor_url?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body.collection_name === 'string' ? body.collection_name.trim() : ''
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
  const creator = normalizeSolanaWalletAddress(typeof body.creator_wallet === 'string' ? body.creator_wallet : '')
  const supply = Number(body.total_supply)
  const price = Number(body.mint_price)
  const currency = body.currency === 'USDC' ? 'USDC' : 'SOL'
  const limit = Number(body.wallet_mint_limit)

  if (!name || name.length > 120) return NextResponse.json({ error: 'Invalid collection name' }, { status: 400 })
  if (!symbol || symbol.length > 16) return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 })
  if (!creator) return NextResponse.json({ error: 'Invalid creator wallet' }, { status: 400 })
  if (!Number.isInteger(supply) || supply < 1 || supply > 1_000_000) {
    return NextResponse.json({ error: 'Invalid total supply' }, { status: 400 })
  }
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: 'Invalid mint price' }, { status: 400 })
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ error: 'Invalid wallet mint limit' }, { status: 400 })
  }

  const treasury =
    typeof body.treasury_wallet === 'string' && body.treasury_wallet.trim()
      ? normalizeSolanaWalletAddress(body.treasury_wallet.trim())
      : null

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_submissions')
    .insert({
      collection_name: name,
      symbol,
      description: typeof body.description === 'string' ? body.description.slice(0, 4000) : null,
      image_url: typeof body.image_url === 'string' ? body.image_url.trim().slice(0, 2000) : null,
      total_supply: supply,
      mint_price: price,
      currency,
      wallet_mint_limit: limit,
      launch_date: typeof body.launch_date === 'string' ? body.launch_date : null,
      creator_wallet: creator,
      treasury_wallet: treasury,
      magic_eden_url: typeof body.magic_eden_url === 'string' ? body.magic_eden_url.trim().slice(0, 2000) : null,
      tensor_url: typeof body.tensor_url === 'string' ? body.tensor_url.trim().slice(0, 2000) : null,
      status: 'PENDING_REVIEW',
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('owl_center_submissions', error)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: (data as { id: string }).id })
}
