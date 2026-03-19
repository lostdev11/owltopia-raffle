import { NextRequest, NextResponse } from 'next/server'
import { processEndedRafflesWithoutWinners } from '@/lib/draw-ended-raffles'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/draw-ended-raffles
 * Called by Vercel Cron to select winners for ended raffles that meet the threshold.
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
    const results = await processEndedRafflesWithoutWinners()

    return NextResponse.json({
      ok: true,
      processedCount: results.length,
      results: results.map(r => ({
        raffleId: r.raffleId,
        raffleTitle: r.raffleTitle,
        success: r.success,
        winnerWallet: r.winnerWallet ?? undefined,
        extended: r.extended,
      })),
    })
  } catch (error) {
    console.error('Cron draw-ended-raffles error:', error)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
