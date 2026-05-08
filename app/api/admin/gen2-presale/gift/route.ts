import { NextRequest, NextResponse } from 'next/server'

import { getGen2PresaleAdminMaxGiftQuantity } from '@/lib/gen2-presale/admin-gift-limits'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rlIp = rateLimit(`gen2-gift-ip:${ip}`, 45, 60_000)
    const rlActor = rateLimit(`gen2-gift-actor:${session.wallet}`, 30, 60_000)
    if (!rlIp.allowed || !rlActor.allowed) {
      return NextResponse.json(
        { error: 'Too many gift requests — wait a minute and retry.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    let body: { wallet?: string; quantity?: number }
    try {
      body = (await request.json()) as { wallet?: string; quantity?: number }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const wallet = normalizeSolanaWalletAddress(typeof body.wallet === 'string' ? body.wallet : '')
    if (!wallet) {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const actorNorm = normalizeSolanaWalletAddress(session.wallet)
    if (!actorNorm) {
      return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
    }

    const maxGift = getGen2PresaleAdminMaxGiftQuantity()
    const qty = Number(body.quantity)
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > maxGift) {
      return NextResponse.json(
        { error: `quantity must be an integer from 1 to ${maxGift}` },
        { status: 400 }
      )
    }

    const db = getSupabaseAdmin()
    const { error } = await db.rpc('gift_gen2_presale_mints', {
      p_actor_wallet: actorNorm,
      p_recipient_wallet: wallet,
      p_quantity: qty,
    })
    if (error) {
      const msg = error.message || ''
      if (msg.includes('gen2_presale_wallet_cap_exceeded')) {
        return NextResponse.json(
          {
            error: 'Recipient would exceed 20 total presale credits for this wallet.',
            code: 'wallet_cap',
          },
          { status: 409 }
        )
      }
      if (msg.includes('does not exist') || msg.includes('42883')) {
        return NextResponse.json(
          {
            error:
              'Gift RPC out of date. Apply Supabase migration 095_gen2_presale_gift_audit.sql (actor + audit trail).',
          },
          { status: 503 }
        )
      }
      console.error('admin gen2-presale gift:', error)
      return NextResponse.json({ error: error.message || 'Gift failed' }, { status: 500 })
    }

    console.info(
      JSON.stringify({
        tag: 'gen2_presale_gift',
        actorWallet: actorNorm,
        recipientWallet: wallet,
        quantity: qty,
        ts: new Date().toISOString(),
      })
    )

    const balance = await getBalanceByWallet(wallet)
    return NextResponse.json({ ok: true, balance })
  } catch (error) {
    console.error('admin gen2-presale gift:', error)
    return NextResponse.json({ error: 'Gift failed' }, { status: 500 })
  }
}
