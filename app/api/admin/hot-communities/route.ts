import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getHotCommunityRows } from '@/lib/db/hot-communities'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/hot-communities
 * NFT communities with recent ticket momentum for admin triage and promotion.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const communities = await getHotCommunityRows()
    return NextResponse.json({
      communities,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Admin hot-communities API error:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
