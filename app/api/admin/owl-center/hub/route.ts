import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { buildLaunchpadHubPayload } from '@/lib/owl-center/launchpad-hub'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-hub:${ip}`, 120, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const payload = await buildLaunchpadHubPayload()
    return NextResponse.json(payload)
  } catch (e) {
    console.error('launchpad hub', e)
    return NextResponse.json({ error: 'hub_failed' }, { status: 500 })
  }
}
