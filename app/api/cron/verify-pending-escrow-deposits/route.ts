import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, listRaffleIdsPendingEscrowDepositVerification } from '@/lib/db/raffles'
import { verifyPrizeDepositInternal } from '@/lib/raffles/verify-prize-deposit-internal'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/verify-pending-escrow-deposits
 * Activates NFT / partner SPL raffles after `register-deposit-tx` when immediate verify missed RPC lag.
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
    const ids = await listRaffleIdsPendingEscrowDepositVerification(45)
    let verified = 0
    let skipped = 0

    for (const id of ids) {
      const raffle = await getRaffleById(id)
      if (!raffle || raffle.prize_deposited_at) {
        skipped++
        continue
      }
      if (raffle.prize_type !== 'nft' && !isPartnerSplPrizeRaffle(raffle)) {
        skipped++
        continue
      }
      const result = await verifyPrizeDepositInternal(id, null)
      if (result.ok && !result.alreadyVerified) verified++
      else if (result.ok && result.alreadyVerified) skipped++
    }

    return NextResponse.json({
      ok: true,
      scanned: ids.length,
      newlyVerified: verified,
      skipped,
    })
  } catch (error) {
    console.error('Cron verify-pending-escrow-deposits error:', error)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
