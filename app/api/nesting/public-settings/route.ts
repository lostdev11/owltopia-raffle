import { NextResponse } from 'next/server'
import { getNestingPublicSettings } from '@/lib/db/nesting-public-settings'
import { isNestingGloballyDisabled } from '@/lib/nesting/policy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nesting/public-settings
 * Public: whether the marketing /nesting page is visible to non-admins.
 */
export async function GET() {
  try {
    const row = await getNestingPublicSettings()
    const landingPublic = !row || row.landing_public === true
    return NextResponse.json(
      { landingPublic, nestingDisabled: await isNestingGloballyDisabled() },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      }
    )
  } catch (e) {
    console.error('[nesting/public-settings]', e)
    return NextResponse.json(
      { landingPublic: false, nestingDisabled: await isNestingGloballyDisabled() },
      { status: 200 }
    )
  }
}
