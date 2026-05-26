import { NextRequest, NextResponse } from 'next/server'

import { forbidUnlessSelfOrAdmin } from '@/lib/api-wallet-auth'
import { requireSession } from '@/lib/auth-server'
import { getOwlCenterPresaleTenantBySlug } from '@/lib/db/owl-center-presale-tenants'
import { executeOwlCenterPresaleConfirm } from '@/lib/owl-center-presale/confirm-core'
import { normalizeOwlCenterPresaleSlug } from '@/lib/owl-center-presale/slug'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const SIG_REGEX = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/

type RouteContext = { params: Promise<{ slug: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const { slug: rawSlug } = await context.params
    const slug = normalizeOwlCenterPresaleSlug(rawSlug)
    if (!slug) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`oc-presale-confirm:${slug}:${ip}`, 40, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const tenant = await getOwlCenterPresaleTenantBySlug(slug)
    if (!tenant || !tenant.is_enabled) {
      return NextResponse.json({ error: 'Presale not found' }, { status: 404 })
    }

    let body: { buyerWallet?: string; quantity?: number; txSignature?: string; solUsdPriceUsed?: number | string }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const buyerNorm = normalizeSolanaWalletAddress(typeof body.buyerWallet === 'string' ? body.buyerWallet : '')
    if (!buyerNorm) {
      return NextResponse.json({ error: 'Invalid buyer wallet' }, { status: 400 })
    }

    const authz = await forbidUnlessSelfOrAdmin(session, buyerNorm)
    if (authz) return authz

    const qty = Number(body.quantity)
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > tenant.max_spots_per_purchase) {
      return NextResponse.json(
        { error: `quantity must be an integer from 1 to ${tenant.max_spots_per_purchase}` },
        { status: 400 }
      )
    }

    const txSignature = typeof body.txSignature === 'string' ? body.txSignature.trim() : ''
    if (!txSignature || !SIG_REGEX.test(txSignature)) {
      return NextResponse.json({ error: 'Invalid transaction signature' }, { status: 400 })
    }

    const rawSolUsd = body.solUsdPriceUsed
    let solUsdOverride: number | undefined
    if (typeof rawSolUsd === 'number' && Number.isFinite(rawSolUsd) && rawSolUsd > 0) {
      solUsdOverride = rawSolUsd
    } else if (typeof rawSolUsd === 'string' && rawSolUsd.trim()) {
      const n = Number(rawSolUsd.trim())
      if (Number.isFinite(n) && n > 0) solUsdOverride = n
    }

    const result = await executeOwlCenterPresaleConfirm({
      tenant,
      buyerWallet: buyerNorm,
      quantity: qty,
      txSignature,
      solUsdPriceUsed: solUsdOverride,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.message, code: result.code }, { status: result.httpStatus })
    }

    if (!result.inserted && result.reason === 'duplicate_tx') {
      return NextResponse.json(
        {
          error: 'This transaction was already recorded',
          code: 'duplicate_tx',
          txSignature: result.txSignature,
          explorerUrl: result.explorerUrl,
          balance: result.balance,
          stats: result.stats,
        },
        { status: 409 }
      )
    }

    return NextResponse.json({
      ok: true,
      txSignature: result.txSignature,
      explorerUrl: result.explorerUrl,
      balance: result.balance,
      stats: result.stats,
    })
  } catch (error) {
    console.error('owl-center presale confirm:', error)
    return NextResponse.json({ error: 'Confirmation failed' }, { status: 500 })
  }
}
