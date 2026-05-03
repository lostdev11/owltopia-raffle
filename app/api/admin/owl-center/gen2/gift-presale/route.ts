import { NextRequest, NextResponse } from 'next/server'

import { getGen2PresaleAdminMaxGiftQuantity } from '@/lib/gen2-presale/admin-gift-limits'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-gift:${ip}`, 45, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { wallet?: string; quantity?: number }
  try {
    body = (await request.json()) as { wallet?: string; quantity?: number }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const wallet = normalizeSolanaWalletAddress(typeof body.wallet === 'string' ? body.wallet : '')
  if (!wallet) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })

  const actorNorm = normalizeSolanaWalletAddress(session.wallet)
  if (!actorNorm) return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })

  const maxGift = getGen2PresaleAdminMaxGiftQuantity()
  const qty = Number(body.quantity)
  if (!Number.isInteger(qty) || qty < 1 || qty > maxGift) {
    return NextResponse.json({ error: `quantity must be 1–${maxGift}` }, { status: 400 })
  }

  const db = getSupabaseAdmin()
  const { error } = await db.rpc('gift_gen2_presale_mints', {
    p_actor_wallet: actorNorm,
    p_recipient_wallet: wallet,
    p_quantity: qty,
  })
  if (error) {
    console.error('owl-center gift-presale', error)
    return NextResponse.json({ error: error.message || 'Gift failed' }, { status: 500 })
  }

  const balance = await getBalanceByWallet(wallet)
  return NextResponse.json({ ok: true, balance })
}
