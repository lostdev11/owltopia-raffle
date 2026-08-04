import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { resolveOwlSendHolderFeeQuote } from '@/lib/owl-send/holder-fee-quote'
import { formatOwlSendFeeSol } from '@/lib/owl-send/fee'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

export const dynamic = 'force-dynamic'

/**
 * GET /api/owl-send/holder-fee?wallet=…&lines=1
 * Public quote for Owltopia holder discount on OwlSend platform fee.
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`owl-send-holder-fee:${ip}`, 60, 60_000)
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

    const linesRaw = Number(request.nextUrl.searchParams.get('lines') ?? '1')
    const lineCount = Number.isFinite(linesRaw) ? Math.max(0, Math.floor(linesRaw)) : 1

    const quote = await resolveOwlSendHolderFeeQuote({ wallet, lineCount })

    return NextResponse.json({
      wallet,
      gen1Count: quote.gen1Count,
      gen2Count: quote.gen2Count,
      gen1Rank: quote.gen1Rank,
      gen2Rank: quote.gen2Rank,
      bestRank: quote.bestRank,
      roleName: quote.roleName,
      discountBps: quote.discountBps,
      discountPercent: quote.discountPercent,
      baseFeeLamportsPerLine: quote.baseFeeLamportsPerLine,
      feeLamportsPerLine: quote.feeLamportsPerLine,
      feeLamportsTotal: quote.feeLamportsTotal,
      feeSolPerLine: quote.feeLamportsPerLine / LAMPORTS_PER_SOL,
      feeSolPerLineLabel: formatOwlSendFeeSol(quote.feeLamportsPerLine / LAMPORTS_PER_SOL),
      baseFeeSolPerLine: quote.baseFeeLamportsPerLine / LAMPORTS_PER_SOL,
      checkAvailable: quote.checkAvailable,
    })
  } catch (e) {
    console.error('owl-send holder-fee GET', e)
    return NextResponse.json({ error: 'Failed to quote holder fee' }, { status: 500 })
  }
}
