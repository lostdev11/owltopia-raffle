import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { backfillCoreLaunchAssetRoyalties } from '@/lib/owl-center/core-asset-royalties'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseMints(body: unknown): string[] | undefined {
  if (!body || typeof body !== 'object') return undefined
  const mints = (body as { mints?: unknown }).mints
  if (!Array.isArray(mints)) return undefined
  return mints.filter((row): row is string => typeof row === 'string' && row.trim().length > 0)
}

/**
 * POST /api/admin/owl-center/collections/[id]/core-royalties
 * Adds Metaplex Core Royalties plugins onto minted assets (explorers/DAS ignore collection inherit).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-core-royalties:${ip}`, 8, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await context.params
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
