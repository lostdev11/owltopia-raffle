import { NextRequest, NextResponse } from 'next/server'

import { listEnabledOwlCenterPresaleTenantsPublic } from '@/lib/db/owl-center-presale-tenants'
import { owlCenterPresalePublicPath } from '@/lib/owl-center-presale/slug'
import type { OwlCenterPresaleListItem } from '@/lib/owl-center-presale/types'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/** GET — enabled Owl Center presale utilities (public hub listing). */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`oc-presale-list:${ip}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const tenants = await listEnabledOwlCenterPresaleTenantsPublic()
    const presales: OwlCenterPresaleListItem[] = tenants.map((t) => ({
      slug: t.slug,
      display_name: t.display_name,
      headline: t.headline,
      is_live: t.is_live,
      theme: { primary: t.theme.primary, accent: t.theme.accent },
      presale_url: owlCenterPresalePublicPath(t.slug),
    }))
    return NextResponse.json({ presales })
  } catch (error) {
    console.error('owl-center presale list:', error)
    return NextResponse.json({ error: 'Failed to load presales' }, { status: 500 })
  }
}
