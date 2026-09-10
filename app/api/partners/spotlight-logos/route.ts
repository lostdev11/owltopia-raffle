import { NextResponse } from 'next/server'
import { getActivePartnerCommunityCreatorRows } from '@/lib/raffles/partner-communities'
import { getActivePartnerSpotlightBrandLogos } from '@/lib/db/partner-spotlight-brands'
import {
  mergePartnerSpotlightBrands,
  partnerLogoFromCommunityRow,
  PARTNER_SPOTLIGHT_BRANDS,
} from '@/lib/partner-logos'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const revalidate = 45

/**
 * GET /api/partners/spotlight-logos
 * Public: Partner Spotlight brands (DB-backed when migrated; else static) plus active creators with logo_url.
 * Retiring a partner (Discord `/owltopia-partner retire` or Owl Vision suspend) deactivates DB brands
 * so they drop out of this response without a redeploy.
 */
export async function GET() {
  try {
    const [dbBrands, rows] = await Promise.all([
      getActivePartnerSpotlightBrandLogos(),
      getActivePartnerCommunityCreatorRows(),
    ])
    const base = dbBrands ?? PARTNER_SPOTLIGHT_BRANDS
    const fromCreators = rows
      .map((r) => partnerLogoFromCommunityRow(r))
      .filter((l): l is NonNullable<typeof l> => l != null)
    const logos = mergePartnerSpotlightBrands(fromCreators, base)
    return NextResponse.json(
      { logos },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=45, stale-while-revalidate=120',
        },
      }
    )
  } catch (error) {
    console.error('[GET /api/partners/spotlight-logos]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
