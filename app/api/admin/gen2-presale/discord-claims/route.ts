import { NextRequest, NextResponse } from 'next/server'

import { listDiscordRoleClaimsForAdmin } from '@/lib/db/discord-role-claims'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/gen2-presale/discord-claims?limit=100
 * Admin audit log of Gen2 Discord role claims.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const limitRaw = request.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : 100

    const claims = await listDiscordRoleClaimsForAdmin(limit)

    console.info('[admin/gen2-presale/discord-claims] listed', {
      tag: 'gen2_discord_role_claim_audit',
      admin_wallet: session.wallet,
      count: claims.length,
    })

    return NextResponse.json({ claims })
  } catch (e) {
    console.error('[admin/gen2-presale/discord-claims]', e)
    return NextResponse.json({ error: 'Failed to load Discord claims' }, { status: 500 })
  }
}
