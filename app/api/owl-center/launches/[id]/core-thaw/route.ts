import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { runCoreCollectionThawForLaunch } from '@/lib/owl-center/core-collection-thaw'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST /api/owl-center/launches/[id]/core-thaw
 * Creator or admin thaw for Metaplex Core Freeze Collection.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`creator-core-thaw:${ip}`, 20, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid launch id' }, { status: 400 })
  }

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  const result = await runCoreCollectionThawForLaunch(id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true, signature: result.signature, launch: result.launch })
}
