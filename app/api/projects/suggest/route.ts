import { NextRequest, NextResponse } from 'next/server'
import { suggestPlatformProjectsPublic } from '@/lib/db/platform-projects'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/projects/suggest?q= — public typeahead for raffle browse `?collection=`.
 * Returns catalog fields only (no CRM notes).
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`projects-suggest:${ip}`, 60, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
  }

  try {
    const q = request.nextUrl.searchParams.get('q') ?? ''
    const projects = await suggestPlatformProjectsPublic(q, 8)
    return NextResponse.json({ projects })
  } catch (error) {
    console.error('[projects/suggest GET]', error)
    const msg = safeErrorMessage(error)
    if (msg.toLowerCase().includes('platform_projects') || msg.includes('does not exist')) {
      return NextResponse.json({ projects: [] })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
