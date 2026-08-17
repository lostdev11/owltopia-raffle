import { NextResponse, type NextRequest } from 'next/server'

import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { mintCanonicalPath } from '@/lib/owl-center/mint-share'

/**
 * Short mint link: /m/<slug> → /owl-center/collection/<canonical-slug>
 *
 * Social crawlers (X, Discord, iMessage) follow the redirect to the canonical
 * mint page, which serves the collection-PFP OpenGraph preview.
 * Former `sub-<uuid>` slugs resolve via alias after the share link is promoted
 * to the collection name.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const clean = (slug ?? '').trim()
  if (!clean) {
    return NextResponse.redirect(new URL('/owl-center', _req.url))
  }
  const launch = await getOwlCenterLaunchBySlug(clean)
  const target = mintCanonicalPath(launch?.slug || clean)
  return NextResponse.redirect(new URL(target, _req.url), { status: 308 })
}
