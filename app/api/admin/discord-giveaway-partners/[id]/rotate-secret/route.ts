import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { rotateDiscordGiveawayPartnerSecret } from '@/lib/db/discord-giveaway-partners'
import { safeErrorMessage } from '@/lib/safe-error'
import type { DiscordGiveawayPartnerTenant } from '@/lib/types'

export const dynamic = 'force-dynamic'

function redactTenant(t: DiscordGiveawayPartnerTenant) {
  const { api_secret_hash: _h, ...rest } = t
  void _h
  return rest
}

/**
 * POST /api/admin/discord-giveaway-partners/[id]/rotate-secret
 * Invalidates the previous API secret. Returns new apiSecret once.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const result = await rotateDiscordGiveawayPartnerSecret(id)
    if (!result) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    return NextResponse.json({
      partner: redactTenant(result.tenant),
      apiSecret: result.apiSecret,
    })
  } catch (error) {
    console.error('[admin/discord-giveaway-partners rotate-secret]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
