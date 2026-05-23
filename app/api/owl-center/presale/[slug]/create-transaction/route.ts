import { Connection, PublicKey } from '@solana/web3.js'
import { NextRequest, NextResponse } from 'next/server'

import { forbidUnlessSelfOrAdmin } from '@/lib/api-wallet-auth'
import { requireSession } from '@/lib/auth-server'
import { getOwlCenterPresaleTenantBySlug } from '@/lib/db/owl-center-presale-tenants'
import { buildOwlCenterPresalePaymentTransaction } from '@/lib/owl-center-presale/build-transaction'
import {
  getOwlCenterPresaleBalanceByWallet,
  owlCenterPresaleCreditsRemainingForWallet,
  sumOwlCenterPresaleSold,
} from '@/lib/owl-center-presale/db'
import { computeOwlCenterPurchaseLamports, getOwlCenterPresaleServerConfig } from '@/lib/owl-center-presale/pricing'
import { normalizeOwlCenterPresaleSlug } from '@/lib/owl-center-presale/slug'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'

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
    const rl = rateLimit(`oc-presale-create-tx:${slug}:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const tenant = await getOwlCenterPresaleTenantBySlug(slug)
    if (!tenant || !tenant.is_enabled) {
      return NextResponse.json({ error: 'Presale not found' }, { status: 404 })
    }
    if (!tenant.is_live) {
      return NextResponse.json(
        { error: 'Presale is not live yet.', code: 'presale_not_live' },
        { status: 403 }
      )
    }

    let body: { buyerWallet?: string; quantity?: number }
    try {
      body = (await request.json()) as { buyerWallet?: string; quantity?: number }
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
    const maxPerPurchase = tenant.max_spots_per_purchase
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1 || qty > maxPerPurchase) {
      return NextResponse.json(
        { error: `quantity must be an integer between 1 and ${maxPerPurchase}` },
        { status: 400 }
      )
    }

    const bal = await getOwlCenterPresaleBalanceByWallet(tenant.id, buyerNorm)
    const walletRemaining = owlCenterPresaleCreditsRemainingForWallet(bal, tenant.max_credits_per_wallet)
    if (walletRemaining <= 0) {
      return NextResponse.json(
        { error: 'This wallet already has the maximum presale credits.', code: 'wallet_cap' },
        { status: 409 }
      )
    }
    if (qty > walletRemaining) {
      return NextResponse.json(
        {
          error: `You can buy at most ${walletRemaining} more spot(s) on this wallet.`,
          code: 'wallet_cap',
          wallet_remaining: walletRemaining,
        },
        { status: 409 }
      )
    }

    let cfg
    try {
      cfg = await getOwlCenterPresaleServerConfig(tenant)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Server configuration error'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    const sold = await sumOwlCenterPresaleSold(tenant.id)
    const remaining = cfg.presaleSupply - sold
    if (remaining <= 0) {
      return NextResponse.json({ error: 'Presale sold out', code: 'sold_out' }, { status: 409 })
    }
    if (qty > remaining) {
      return NextResponse.json(
        { error: `Only ${remaining} presale spots remaining`, code: 'insufficient_supply', remaining },
        { status: 409 }
      )
    }

    const breakdown = computeOwlCenterPurchaseLamports(cfg, qty)
    const buyerPk = new PublicKey(buyerNorm)
    const connection = new Connection(resolveServerSolanaRpcUrl(), 'confirmed')
    const built = await buildOwlCenterPresalePaymentTransaction({
      connection,
      buyer: buyerPk,
      breakdown,
      treasury: cfg.treasuryWallet,
    })

    return NextResponse.json({
      transaction: built.serializedBase64,
      recentBlockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
      expected: {
        buyerWallet: buyerNorm,
        quantity: qty,
        unitPriceUsdc: breakdown.unitPriceUsdc,
        solUsdPriceUsed: breakdown.solUsdPrice,
        unitLamports: breakdown.unitLamports.toString(),
        totalLamports: breakdown.totalLamports.toString(),
        treasuryLamports: breakdown.treasuryLamports.toString(),
        treasuryWallet: cfg.treasuryWallet.toBase58(),
      },
    })
  } catch (error) {
    console.error('owl-center presale create-transaction:', error)
    return NextResponse.json({ error: 'Failed to build transaction' }, { status: 500 })
  }
}
