import { NextRequest, NextResponse } from 'next/server'

import { buildCollectionMintState } from '@/lib/owl-center/collection-mint-state'
import { getOwlCenterAdminWallet } from '@/lib/owl-center/admin-access'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const ip = getClientIp(request)
  const rl = rateLimit(`owl-col-state:${ip}`, 120, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { slug: raw } = await context.params
  const slug = raw?.trim().toLowerCase() ?? ''
  if (!SLUG_RE.test(slug) || slug === 'gen2') {
    return NextResponse.json({ error: 'Invalid collection slug' }, { status: 400 })
  }

  const launch = await getOwlCenterLaunchBySlug(slug)
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  if (launch.mint_mode !== 'public_simple') {
    return NextResponse.json({ error: 'This collection does not use the public mint console' }, { status: 400 })
  }

  const adminWallet = await getOwlCenterAdminWallet(request)
  const state = await buildCollectionMintState(slug, { includeSystemLogs: !!adminWallet })
  if (!state) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  return NextResponse.json(state)
}
