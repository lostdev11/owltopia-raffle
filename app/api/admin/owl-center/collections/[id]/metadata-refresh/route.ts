import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import {
  getMetadataRefreshStatusForLaunch,
  runMetadataRefreshForLaunch,
} from '@/lib/owl-center/metadata-refresh'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** GET — preview mints that need a metadata URI/name refresh. POST — run on-chain updateV1. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const status = await getMetadataRefreshStatusForLaunch(id)
  if (!status) return jsonError('Launch not found', 404)

  return NextResponse.json(status)
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-metadata-refresh:${ip}`, 8, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  let body: { action?: string; mints?: string[] }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const action = body.action?.trim().toLowerCase() ?? 'refresh_all'
  if (action !== 'refresh_all' && action !== 'refresh_mints') {
    return jsonError('Invalid action — use refresh_all or refresh_mints', 400)
  }

  const result = await runMetadataRefreshForLaunch(
    id,
    action === 'refresh_mints' ? { mints: body.mints } : undefined
  )

  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : 400
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status })
  }

  return NextResponse.json({
    ok: true,
    refreshed: result.refreshed,
    skipped: result.skipped,
    collection: result.collection,
  })
}
