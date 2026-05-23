import { NextRequest, NextResponse } from 'next/server'

import { forbidUnlessSelfOrAdmin } from '@/lib/api-wallet-auth'
import { requireSession } from '@/lib/auth-server'
import { getOwlCenterPresaleTenantBySlug } from '@/lib/db/owl-center-presale-tenants'
import { getOwlCenterPresaleBalanceByWallet } from '@/lib/owl-center-presale/db'
import { normalizeOwlCenterPresaleSlug } from '@/lib/owl-center-presale/slug'
import type { OwlCenterPresaleBalance } from '@/lib/owl-center-presale/types'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const { slug: rawSlug } = await context.params
    const slug = normalizeOwlCenterPresaleSlug(rawSlug)
    if (!slug) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`oc-presale-balance:${slug}:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const tenant = await getOwlCenterPresaleTenantBySlug(slug)
    if (!tenant || !tenant.is_enabled) {
      return NextResponse.json({ error: 'Presale not found' }, { status: 404 })
    }

    const walletRaw = request.nextUrl.searchParams.get('wallet') ?? ''
    const walletNorm = normalizeSolanaWalletAddress(walletRaw)
    if (!walletNorm) {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const authz = await forbidUnlessSelfOrAdmin(session, walletNorm)
    if (authz) return authz

    const row = await getOwlCenterPresaleBalanceByWallet(tenant.id, walletNorm)
    const payload: OwlCenterPresaleBalance =
      row ?? {
        tenant_id: tenant.id,
        wallet: walletNorm,
        purchased_mints: 0,
        gifted_mints: 0,
        used_mints: 0,
        available_mints: 0,
      }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('owl-center presale balance:', error)
    return NextResponse.json({ error: 'Failed to load balance' }, { status: 500 })
  }
}
