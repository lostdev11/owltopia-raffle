import { NextRequest, NextResponse } from 'next/server'
import { processEndedCommunityGiveawaysForAutoDraw } from '@/lib/community-giveaways/auto-draw'
import { processEndedRafflesWithoutWinners } from '@/lib/draw-ended-raffles'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/draw-ended-raffles
 * Called by Vercel Cron: ended ticket raffles (threshold / extensions) and ended community giveaways (past ends_at).
 * Secured by CRON_SECRET (Bearer token in Authorization header).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'server error' }, { status: 401 })
  }

  try {
    const [raffleResults, communityResults] = await Promise.all([
      processEndedRafflesWithoutWinners(),
      processEndedCommunityGiveawaysForAutoDraw(),
    ])

    return NextResponse.json({
      ok: true,
      processedCount: raffleResults.length,
      results: raffleResults.map(r => ({
        raffleId: r.raffleId,
        raffleTitle: r.raffleTitle,
        success: r.success,
        winnerWallet: r.winnerWallet ?? undefined,
        extended: r.extended,
      })),
      communityGiveaways: {
        processedCount: communityResults.length,
        results: communityResults.map(c => ({
          giveawayId: c.giveawayId,
          title: c.title,
          drawn: c.drawn,
          winnerWallet: c.winnerWallet ?? undefined,
          skippedReason: c.skippedReason,
        })),
      },
    })
  } catch (error) {
    console.error('Cron draw-ended-raffles error:', error)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
