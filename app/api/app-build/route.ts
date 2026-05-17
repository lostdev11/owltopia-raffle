import { NextResponse } from 'next/server'
import { getAppBuildId } from '@/lib/app-build'

export const dynamic = 'force-dynamic'

/** Public: current deployment build id (for stale-tab detection on mobile). */
export async function GET() {
  return NextResponse.json(
    { buildId: getAppBuildId() },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  )
}
