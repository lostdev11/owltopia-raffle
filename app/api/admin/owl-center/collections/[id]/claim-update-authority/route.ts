import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import {
  claimCoreCollectionUpdateAuthorityForLaunch,
  getCoreUaStatusForLaunch,
} from '@/lib/owl-center/claim-core-ua'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session
  const { id } = await context.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid launch id' }, { status: 400 })
  const status = await getCoreUaStatusForLaunch(id)
  if (!status.ok) return NextResponse.json({ error: status.error }, { status: status.status })
  return NextResponse.json(status)
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session
  const ip = getClientIp(request)
  if (!rateLimit(`admin-claim-ua:${ip}`, 20, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const { id } = await context.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid launch id' }, { status: 400 })
  const result = await claimCoreCollectionUpdateAuthorityForLaunch(id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({
    ok: true,
    updateAuthority: result.updateAuthority,
    platformDelegate: result.platformDelegate,
    alreadyClaimed: result.alreadyClaimed ?? false,
    launch: result.launch,
  })
}
