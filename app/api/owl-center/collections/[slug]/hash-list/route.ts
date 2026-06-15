import { NextRequest, NextResponse } from 'next/server'

import { collectMintedNftMintsForLaunch } from '@/lib/owl-center/hash-list'
import { formatHashListText } from '@/lib/owl-center/marketplace-urls'
import { ensureSelloutMarketplacePrepIfNeeded } from '@/lib/owl-center/sellout-marketplace-prep'
import { getOwlCenterLaunchBySlug, getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { getMarketplaceReadinessByLaunchId } from '@/lib/db/owl-center-marketplace'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Download hash list (mint addresses) for ME / Tensor creator submission. */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-col-hashlist:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug: raw } = await context.params
  const slug = raw?.trim().toLowerCase() ?? ''
  if (!SLUG_RE.test(slug) || slug === 'gen2') {
    return NextResponse.json({ error: 'Invalid collection slug' }, { status: 400 })
  }

  const launch = await getOwlCenterLaunchBySlug(slug)
  if (!launch || launch.mint_mode !== 'public_simple') {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  const adminLaunch = await getOwlCenterLaunchBySlugAdmin(slug)
  if (adminLaunch) await ensureSelloutMarketplacePrepIfNeeded(adminLaunch)

  const mp = await getMarketplaceReadinessByLaunchId(launch.id)
  let text = mp?.hash_list_text?.trim() ?? ''
  if (!text) {
    const mints = await collectMintedNftMintsForLaunch(launch.id)
    text = formatHashListText(mints)
  }

  if (!text) {
    return NextResponse.json({ error: 'No mints recorded yet — hash list available after first mint' }, { status: 404 })
  }

  const format = request.nextUrl.searchParams.get('format')
  if (format === 'json') {
    const mints = text.split('\n').filter(Boolean)
    return NextResponse.json({ slug, mint_count: mints.length, mints })
  }

  return new NextResponse(text + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-hash-list.txt"`,
      'Cache-Control': 'no-store',
    },
  })
}
