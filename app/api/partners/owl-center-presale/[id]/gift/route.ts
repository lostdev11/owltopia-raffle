import { NextRequest, NextResponse } from 'next/server'

import { isOwlVisionAdmin } from '@/lib/admin/access'
import { requireSession } from '@/lib/auth-server'
import { getOwlCenterPresaleTenantById } from '@/lib/db/owl-center-presale-tenants'
import { canGiftOwlCenterPresaleCredits } from '@/lib/owl-center-presale/access'
import { giftOwlCenterPresaleCredits } from '@/lib/owl-center-presale/gift'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** POST — gift mint credits (Owltopia admin or approved partner owner). */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rlIp = rateLimit(`oc-presale-gift-ip:${ip}`, 45, 60_000)
    const rlActor = rateLimit(`oc-presale-gift-actor:${session.wallet}`, 30, 60_000)
    if (!rlIp.allowed || !rlActor.allowed) {
      return NextResponse.json(
        { error: 'Too many gift requests — wait a minute and retry.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const { id } = await context.params
    const tenant = await getOwlCenterPresaleTenantById(id)
    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const isAdmin = await isOwlVisionAdmin(session.wallet)
    if (!canGiftOwlCenterPresaleCredits({ tenant, actorWallet: session.wallet, isAdmin })) {
      return NextResponse.json(
        { error: 'Gifting requires an approved campaign you own (or admin).' },
        { status: 403 }
      )
    }

    let body: { wallet?: string; wallets?: string[]; quantity?: number }
    try {
      body = (await request.json()) as { wallet?: string; wallets?: string[]; quantity?: number }
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const qty = Number(body.quantity ?? 1)
    const recipients: string[] = []
    if (Array.isArray(body.wallets)) {
      for (const w of body.wallets) {
        const n = normalizeSolanaWalletAddress(typeof w === 'string' ? w : '')
        if (n) recipients.push(n)
      }
    }
    if (typeof body.wallet === 'string') {
      const n = normalizeSolanaWalletAddress(body.wallet)
      if (n) recipients.push(n)
    }
    const unique = [...new Set(recipients)]
    if (unique.length === 0) {
      return NextResponse.json({ error: 'Provide wallet or wallets[]' }, { status: 400 })
    }
    if (unique.length > 50) {
      return NextResponse.json({ error: 'Max 50 wallets per gift request' }, { status: 400 })
    }

    const results: { wallet: string; ok: boolean; error?: string; balance?: unknown }[] = []
    for (const wallet of unique) {
      const result = await giftOwlCenterPresaleCredits({
        tenant,
        actorWallet: session.wallet,
        recipientWallet: wallet,
        quantity: qty,
      })
      if (result.ok) {
        results.push({ wallet, ok: true, balance: result.balance })
      } else {
        results.push({ wallet, ok: false, error: result.error })
      }
    }

    const okCount = results.filter((r) => r.ok).length
    return NextResponse.json({
      ok: okCount === results.length,
      gifted: okCount,
      failed: results.length - okCount,
      results,
    })
  } catch (error) {
    console.error('[partners/owl-center-presale gift]', error)
    return NextResponse.json({ error: 'Gift failed' }, { status: 500 })
  }
}
