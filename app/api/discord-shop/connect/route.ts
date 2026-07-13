import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { parseDiscordMarketplaceLinkState } from '@/lib/discord-marketplace-link-state'
import { requireSession } from '@/lib/auth-server'
import { linkDiscordToWallet } from '@/lib/db/wallet-profiles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  state: z.string().min(8),
})

/**
 * POST /api/discord-shop/connect
 * Links the signed-in wallet to the Discord user id embedded in the bot-generated state token.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) {
      return NextResponse.json({ error: 'Sign in with your wallet first' }, { status: 401 })
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const stateResult = parseDiscordMarketplaceLinkState(parsed.data.state)
    if (!stateResult.ok) {
      return NextResponse.json(
        { error: 'Link expired or invalid. Run /owltopia-shop wallet in Discord again.' },
        { status: 400 }
      )
    }

    const result = await linkDiscordToWallet(
      session.wallet,
      stateResult.discordUserId,
      `discord:${stateResult.discordUserId}`
    )

    if (!result.ok) {
      const status = result.code === 'taken' ? 409 : 500
      return NextResponse.json(
        {
          error:
            result.code === 'taken'
              ? 'This Discord account is already linked to a different wallet.'
              : result.message,
        },
        { status }
      )
    }

    return NextResponse.json({ ok: true, wallet: session.wallet })
  } catch (e) {
    console.error('[discord-shop/connect]', e)
    return NextResponse.json({ error: 'Failed to link wallet' }, { status: 500 })
  }
}
