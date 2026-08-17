import { NextRequest, NextResponse } from 'next/server'

import { buildSimpleMintEligibility } from '@/lib/owl-center/simple-mint-eligibility'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { parseOwlCenterCollectionSlugParam } from '@/lib/owl-center/launch-slug'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-col-elig:${ip}`, 90, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug: raw } = await context.params
  const slug = parseOwlCenterCollectionSlugParam(raw)
  if (!slug) {
    return NextResponse.json({ error: 'Invalid collection slug' }, { status: 400 })
  }

  const launch = await getOwlCenterLaunchBySlug(slug)
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  if (launch.mint_mode !== 'public_simple') {
    return NextResponse.json({ error: 'This collection does not use the public mint console' }, { status: 400 })
  }

  const wallet = request.nextUrl.searchParams.get('wallet')
  const eligibility = await buildSimpleMintEligibility(launch.slug, wallet)
  if (!eligibility) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  return NextResponse.json({ launch, eligibility })
}
