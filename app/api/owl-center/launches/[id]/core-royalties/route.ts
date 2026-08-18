import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { backfillCoreLaunchAssetRoyalties } from '@/lib/owl-center/core-asset-royalties'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseMints(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object') return undefined
  const mints = (body as { mints?: unknown }).mints
  if (!Array.isArray(mints)) return undefined
  return mints.filter((row): row is string => typeof row === 'string' && row.trim().length > 0)
}

/**
 * POST /api/owl-center/launches/[id]/core-royalties
 * Creator or admin backfill of Metaplex Core asset Royalties plugins.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`creator-core-royalties:${ip}`, 8, 60_000).allowed) {
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

  let mints: string[] | undefined
  try {
    mints = parseMints(await request.json())
  } catch {
    mints = undefined
  }

  const result = await backfillCoreLaunchAssetRoyalties(id, mints?.length ? { mints } : undefined)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
