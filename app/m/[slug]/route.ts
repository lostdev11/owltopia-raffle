import { NextResponse, type NextRequest } from 'next/server'

import { mintCanonicalPath } from '@/lib/owl-center/mint-share'

/**
 * Short mint link: /m/<slug> → /owl-center/collection/<slug>
 *
 * Social crawlers (X, Discord, iMessage) follow the redirect to the canonical
 * mint page, which serves the collection-PFP OpenGraph preview.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const clean = (slug ?? '').trim()
  if (!clean) {
    return NextResponse.redirect(new URL('/owl-center', _req.url))
  }
  return NextResponse.redirect(new URL(mintCanonicalPath(clean), _req.url), { status: 308 })
}
