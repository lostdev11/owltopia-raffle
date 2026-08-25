import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { linkPartnerCreatorToDiscordGuild } from '@/lib/admin/link-partner-discord-guild'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { safeErrorMessage } from '@/lib/safe-error'
import type { DiscordGiveawayPartnerTenant } from '@/lib/types'

export const dynamic = 'force-dynamic'

function redactTenant(t: DiscordGiveawayPartnerTenant) {
  const { api_secret_hash: _h, ...rest } = t
  void _h
  return rest
}

function walletFromParams(params: { wallet: string }): string | null {
  const decoded = decodeURIComponent(params.wallet ?? '').trim()
  return normalizeSolanaWalletAddress(decoded)
}

/**
 * POST /api/admin/partner-community-creators/[wallet]/link-discord
 * Body: { discord_guild_id, name?, webhook_url?, status?, contact_note? }
 *
 * Creates (or reuses) a Discord partner tenant for the guild and links it to this
 * allowlisted creator — one step for Owl Vision, no USDC verify required.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ wallet: string }> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { wallet: walletParam } = await context.params
    const creatorWallet = walletFromParams({ wallet: walletParam })
    if (!creatorWallet) {
      return NextResponse.json({ error: 'Invalid creator wallet in path' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const result = await linkPartnerCreatorToDiscordGuild({
      creatorWallet,
      guildId: typeof body.discord_guild_id === 'string' ? body.discord_guild_id : '',
      name: typeof body.name === 'string' ? body.name : null,
      webhookUrl: typeof body.webhook_url === 'string' ? body.webhook_url : null,
      status:
        body.status === 'active' || body.status === 'trial' || body.status === 'suspended'
          ? body.status
          : 'active',
      contactNote: typeof body.contact_note === 'string' ? body.contact_note : null,
      createdByWallet: session.wallet,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      creator: result.creator,
      partner: redactTenant(result.tenant),
      createdTenant: result.createdTenant,
      apiSecret: result.apiSecret,
    })
  } catch (error) {
    console.error('[admin/partner-community-creators link-discord]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
