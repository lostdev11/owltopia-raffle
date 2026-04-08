import { NextResponse } from 'next/server'
import { listPublicCommunityGiveaways } from '@/lib/db/community-giveaways-public'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/community-giveaways
 * Public list of open community pool giveaways (no secrets).
 */
export async function GET() {
  try {
    const giveaways = await listPublicCommunityGiveaways()
    return NextResponse.json({ giveaways })
  } catch (error) {
    console.error('[public/community-giveaways]', error)
    return NextResponse.json({ giveaways: [] })
  }
}
