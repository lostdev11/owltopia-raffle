import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { unlinkDiscordFromWallet } from '@/lib/db/wallet-profiles'

export const dynamic = 'force-dynamic'

/**
 * POST /api/me/discord/unlink
 * Removes Discord link for the signed-in wallet.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const result = await unlinkDiscordFromWallet(session.wallet)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[me/discord/unlink]', e)
    return NextResponse.json({ error: 'Failed to unlink Discord' }, { status: 500 })
  }
}
