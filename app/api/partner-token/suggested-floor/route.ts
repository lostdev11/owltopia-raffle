import { NextRequest, NextResponse } from 'next/server'
import { humanPartnerPrizeToRawUnits } from '@/lib/partner-prize-amount'
import { getPartnerPrizeMintForCurrency, isPartnerPrizeCurrency } from '@/lib/partner-prize-tokens'
import { resolveUsdPricesForMints } from '@/lib/partner-token-price-fetch'
import { computePartnerTokenSuggestedFloor, type PartnerPrizeCurrencyCode } from '@/lib/partner-token-suggested-floor'
import type { RaffleCurrency } from '@/lib/types'
import { getTokenInfo, isRaffleCurrency } from '@/lib/tokens'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function parsePartnerPrizeCurrency(s: string): PartnerPrizeCurrencyCode | null {
  const u = s.trim().toUpperCase()
  if (u === 'SOL' || u === 'USDC' || u === 'TRQ') return u
  return null
}

/**
 * GET /api/partner-token/suggested-floor?prizeCurrency=TRQ&prizeAmount=1000&listingCurrency=SOL
 * Suggests `floor_price` in ticket / listing currency from spot USD prices (Jupiter lite, Helius fill-in).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const prizeCurrency = parsePartnerPrizeCurrency(searchParams.get('prizeCurrency') ?? '')
    const prizeAmountRaw = searchParams.get('prizeAmount')?.trim() ?? ''
    const listingRaw = searchParams.get('listingCurrency')?.trim().toUpperCase() ?? ''

    if (!prizeCurrency || !isPartnerPrizeCurrency(prizeCurrency)) {
      return NextResponse.json(
        { error: 'Invalid or missing prizeCurrency (SOL, USDC, TRQ).' },
        { status: 400 }
      )
    }
    if (!listingRaw || !isRaffleCurrency(listingRaw)) {
      return NextResponse.json(
        { error: 'Invalid or missing listingCurrency (SOL, USDC, OWL).' },
        { status: 400 }
      )
    }
    if (!prizeAmountRaw || humanPartnerPrizeToRawUnits(prizeCurrency, prizeAmountRaw) == null) {
      return NextResponse.json(
        { error: 'Invalid or missing prizeAmount (positive decimal within token decimals).' },
        { status: 400 }
      )
    }

    const prizeAmountHuman = parseFloat(prizeAmountRaw.replace(/,/g, ''))
    if (!Number.isFinite(prizeAmountHuman) || prizeAmountHuman <= 0) {
      return NextResponse.json({ error: 'prizeAmount must be a positive number.' }, { status: 400 })
    }

    const listingCurrency = listingRaw as RaffleCurrency
    const listingMint = getTokenInfo(listingCurrency).mintAddress
    if (!listingMint) {
      return NextResponse.json(
        {
          floorPrice: null,
          listingCurrency,
          source: 'none' as const,
          message:
            listingCurrency === 'OWL'
              ? 'OWL mint is not configured; pick SOL or USDC as ticket currency or set NEXT_PUBLIC_OWL_MINT_ADDRESS.'
              : 'Listing currency mint is missing.',
        },
        { status: 200 }
      )
    }

    const prizeMint = getPartnerPrizeMintForCurrency(prizeCurrency)
    if (!prizeMint) {
      return NextResponse.json({ error: 'Unknown prize mint.' }, { status: 400 })
    }

    const mints = prizeMint === listingMint ? [prizeMint] : [prizeMint, listingMint]
    const { prices: usdPerUnit, source } = await resolveUsdPricesForMints(mints)

    const computed = computePartnerTokenSuggestedFloor({
      prizeCurrency,
      prizeAmountHuman,
      listingCurrency,
      usdPerUnit,
    })

    if (!computed) {
      return NextResponse.json({
        floorPrice: null,
        listingCurrency,
        source,
        message:
          'No spot price available for this pair right now (common for thin markets). Enter floor price manually.',
      })
    }

    const sourceHint =
      source === 'jupiter'
        ? 'Spot estimate (Jupiter). Confirm before publishing.'
        : source === 'helius'
          ? 'Spot estimate (Helius). Confirm before publishing.'
          : null

    return NextResponse.json({
      floorPrice: computed.floorPrice,
      listingCurrency: computed.listingCurrency,
      source,
      message: null as string | null,
      hint: sourceHint,
    })
  } catch (error) {
    console.error('[partner-token/suggested-floor]', error)
    return NextResponse.json(
      {
        floorPrice: null,
        listingCurrency: null,
        source: 'error' as const,
        message: 'Could not load price data. Enter floor price manually.',
      },
      { status: 200 }
    )
  }
}
