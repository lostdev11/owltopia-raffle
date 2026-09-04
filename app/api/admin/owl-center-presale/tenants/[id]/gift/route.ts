import { NextRequest, NextResponse } from 'next/server'

import { requireFullAdminSession } from '@/lib/auth-server'
import { getOwlCenterPresaleTenantById } from '@/lib/db/owl-center-presale-tenants'
import { giftErrorResponse, giftOwlCenterPresaleCredits } from '@/lib/owl-center-presale/gift'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** POST — Owltopia admin gift credits to wallet(s) for any tenant. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-oc-presale-gift:${session.wallet}:${ip}`, 45, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many gift requests' }, { status: 429 })
    }

    const { id } = await context.params
    const tenant = await getOwlCenterPresaleTenantById(id)
    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

    if (unique.length === 1) {
      const result = await giftOwlCenterPresaleCredits({
        tenant,
        actorWallet: session.wallet,
        recipientWallet: unique[0]!,
        quantity: qty,
      })
      if (!result.ok) return giftErrorResponse(result)
      return NextResponse.json({ ok: true, balance: result.balance })
    }

    const results: { wallet: string; ok: boolean; error?: string }[] = []
    for (const wallet of unique.slice(0, 50)) {
      const result = await giftOwlCenterPresaleCredits({
        tenant,
        actorWallet: session.wallet,
        recipientWallet: wallet,
        quantity: qty,
      })
      results.push(result.ok ? { wallet, ok: true } : { wallet, ok: false, error: result.error })
    }
    return NextResponse.json({
      ok: results.every((r) => r.ok),
      results,
    })
  } catch (error) {
    console.error('[admin/owl-center-presale gift]', error)
    return NextResponse.json({ error: 'Gift failed' }, { status: 500 })
  }
}
