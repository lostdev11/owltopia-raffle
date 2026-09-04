import { NextRequest, NextResponse } from 'next/server'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { getOwlSendHolderCounts } from '@/lib/owl-send/holder-counts'
import { quoteOwlSendHolderDiscount } from '@/lib/owl-send/holder-discount'
import {
  formatOwlSwapFeeSol,
  getOwlSwapFeeLamports,
  getOwlSwapFeeLamportsForCount,
} from '@/lib/owl-swap/fee'

export const dynamic = 'force-dynamic'

/**
 * GET /api/owl-swap/holder-fee?wallet=…
 * Quote OwlSwap fee for 1 swap (lineCount=1) using OwlSend holder discount ladder.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`owl-swap-holder-fee:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet required' }, { status: 400 })
    }
    try {
      // eslint-disable-next-line no-new
      new PublicKey(wallet)
    } catch {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const lineCount = 1
    const counts = await getOwlSendHolderCounts(wallet)
    const discount = quoteOwlSendHolderDiscount({
      gen1Count: counts.gen1Count,
      gen2Count: counts.gen2Count,
    })
    const baseFeeLamportsPerLine = getOwlSwapFeeLamports()
    const feeLamportsTotal = getOwlSwapFeeLamportsForCount(lineCount, discount.discountBps)
    const feeLamportsPerLine = feeLamportsTotal

    return NextResponse.json({
      wallet,
      gen1Count: discount.gen1Count,
      gen2Count: discount.gen2Count,
      gen1Rank: discount.gen1Rank,
      gen2Rank: discount.gen2Rank,
      bestRank: discount.bestRank,
      roleName: discount.roleName,
      discountBps: discount.discountBps,
      discountPercent: discount.discountPercent,
      baseFeeLamportsPerLine,
      feeLamportsPerLine,
      feeLamportsTotal,
      feeSolPerLine: feeLamportsPerLine / LAMPORTS_PER_SOL,
      feeSolPerLineLabel: formatOwlSwapFeeSol(feeLamportsPerLine / LAMPORTS_PER_SOL),
      baseFeeSolPerLine: baseFeeLamportsPerLine / LAMPORTS_PER_SOL,
      checkAvailable: counts.checkAvailable,
    })
  } catch (e) {
    console.error('owl-swap holder-fee GET', e)
    return NextResponse.json({ error: 'Failed to quote holder fee' }, { status: 500 })
  }
}
