import { NextRequest, NextResponse } from 'next/server'
import { COMMUNITY_GIVEAWAY_OWL_BOOST_UI_AMOUNT } from '@/lib/config/community-giveaways'
import { countEntriesByGiveawayId, getCommunityGiveawayById } from '@/lib/db/community-giveaways'
import { safeErrorMessage } from '@/lib/safe-error'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/community-giveaways/[id]
 * Minimal public metadata (no wallet leakage).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const g = await getCommunityGiveawayById(id)
    if (!g || g.status === 'draft') {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }

    const entryCount = await countEntriesByGiveawayId(id)
    const startMs = new Date(g.starts_at).getTime()
    const owlBoostWindowOpen =
      isOwlEnabled() &&
      g.status === 'open' &&
      Boolean(g.prize_deposited_at) &&
      !Number.isNaN(startMs) &&
      Date.now() < startMs

    const treasuryWallet =
      process.env.RAFFLE_RECIPIENT_WALLET?.trim() ||
      process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET?.trim() ||
      ''
    const owlInfo = getTokenInfo('OWL')
    const owlPayment =
      owlBoostWindowOpen && treasuryWallet && owlInfo.mintAddress
        ? {
            treasuryWallet,
            mint: owlInfo.mintAddress,
            decimals: owlInfo.decimals,
            uiAmount: COMMUNITY_GIVEAWAY_OWL_BOOST_UI_AMOUNT,
          }
        : null

    return NextResponse.json({
      id: g.id,
      title: g.title,
      description: g.description,
      access_gate: g.access_gate,
      status: g.status,
      starts_at: g.starts_at,
      ends_at: g.ends_at,
      entryCount,
      prizeDeposited: Boolean(g.prize_deposited_at),
      winnerDrawn: Boolean(g.winner_wallet),
      claimed: Boolean(g.claimed_at),
      owlBoostWindowOpen,
      owlBoostUiAmount: COMMUNITY_GIVEAWAY_OWL_BOOST_UI_AMOUNT,
      owlPayment,
    })
  } catch (error) {
    console.error('[public/community-giveaways]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
