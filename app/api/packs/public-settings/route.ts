import { NextResponse } from 'next/server'
import { getPackAccessMode } from '@/lib/db/pack-public-settings'
import { isPacksEnvKillSwitch } from '@/lib/packs/access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/packs/public-settings
 * Public: current launch mode (no wallet list). Used for nav / SSR hints.
 */
export async function GET() {
  try {
    const killSwitch = isPacksEnvKillSwitch()
    const accessMode = killSwitch ? 'restricted' : await getPackAccessMode()
    const isPublic = !killSwitch && accessMode === 'public'
    return NextResponse.json(
      {
        accessMode,
        isPublic,
        killSwitch,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
        },
      }
    )
  } catch (e) {
    console.error('[packs/public-settings]', e)
    return NextResponse.json(
      {
        accessMode: 'restricted' as const,
        isPublic: false,
        killSwitch: isPacksEnvKillSwitch(),
      },
      { status: 200 }
    )
  }
}
