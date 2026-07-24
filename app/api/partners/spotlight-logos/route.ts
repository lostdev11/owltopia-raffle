import { NextResponse } from 'next/server'
import { getActivePartnerCommunityCreatorRows } from '@/lib/raffles/partner-communities'
import { mergePartnerSpotlightBrands, partnerLogoFromCommunityRow } from '@/lib/partner-logos'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const revalidate = 45

/**
 * GET /api/partners/spotlight-logos
 * Public: static Partner Spotlight brands plus active creators that have a logo_url.
 */
export async function GET() {
  try {
    const rows = await getActivePartnerCommunityCreatorRows()
    const fromDb = rows
      .map((r) => partnerLogoFromCommunityRow(r))
      .filter((l): l is NonNullable<typeof l> => l != null)
    const logos = mergePartnerSpotlightBrands(fromDb)
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
