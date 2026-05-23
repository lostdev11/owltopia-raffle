import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterPresaleTenantBySlug } from '@/lib/db/owl-center-presale-tenants'
import { sumOwlCenterPresaleSold } from '@/lib/owl-center-presale/db'
import { getOptionalOwlCenterUnitLamportsQuote } from '@/lib/owl-center-presale/pricing'
import { buildOwlCenterPresaleStatsPayload } from '@/lib/owl-center-presale/purchase-availability'
import { normalizeOwlCenterPresaleSlug } from '@/lib/owl-center-presale/slug'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ slug: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { slug: rawSlug } = await context.params
    const slug = normalizeOwlCenterPresaleSlug(rawSlug)
    if (!slug) {
      return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`oc-presale-stats:${slug}:${ip}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const tenant = await getOwlCenterPresaleTenantBySlug(slug)
    if (!tenant || !tenant.is_enabled) {
      return NextResponse.json({ error: 'Presale not found' }, { status: 404 })
    }

    let sold = 0
    let soldSyncUnavailable = false
    try {
      sold = await sumOwlCenterPresaleSold(tenant.id)
    } catch (e) {
      soldSyncUnavailable = true
      console.warn('[owl-center-presale/stats] sold count failed:', e)
    }

    const quote = await getOptionalOwlCenterUnitLamportsQuote(tenant)
    const payload = buildOwlCenterPresaleStatsPayload({
      tenant,
      sold,
      unitLamports: quote ? quote.unitLamports.toString() : null,
      solUsdPrice: quote?.solUsdPrice ?? null,
      soldSyncUnavailable,
    })

    return NextResponse.json(payload)
  } catch (error) {
    console.error('owl-center presale stats:', error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
