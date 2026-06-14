import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getAssetPackageByLaunchId } from '@/lib/db/owl-center-asset-package'
import { getMarketplaceReadinessByLaunchId } from '@/lib/db/owl-center-marketplace'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { assessLaunchGoLiveReadiness, promoteLaunchToLive } from '@/lib/owl-center/launch-go-live'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const [assetPackage, marketplaceReadiness] = await Promise.all([
    getAssetPackageByLaunchId(id),
    getMarketplaceReadinessByLaunchId(id),
  ])

  const assessment = assessLaunchGoLiveReadiness(launch, assetPackage, marketplaceReadiness)

  return NextResponse.json({
    launch,
    assetPackage,
    marketplaceReadiness,
    assessment,
    public_mint_href:
      assessment.already_live || assessment.ready ? `/owl-center/collection/${launch.slug}` : null,
  })
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-go-live:${ip}`, 30, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  let force = false
  try {
    const body = (await request.json()) as { force?: boolean }
    force = body.force === true
  } catch {
    // empty body ok
  }

  const result = await promoteLaunchToLive(id, { auto: false, force })
  if (!result.ok) {
    if (result.reason === 'not_found') return jsonError('Launch not found', 404)
    return NextResponse.json({ error: 'Not ready for go-live', blockers: result.blockers }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    launch: result.launch,
    already_live: result.already_live,
    public_mint_href: `/owl-center/collection/${result.launch.slug}`,
  })
}
