import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getNestingPublicSettings,
  setNestingLandingPublic,
} from '@/lib/db/nesting-public-settings'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/nesting/public-landing
 * Full admin session. Current toggle + audit fields.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const row = await getNestingPublicSettings()
    if (!row) {
      return NextResponse.json({ error: 'Nesting public settings not found' }, { status: 500 })
    }
    return NextResponse.json(row)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/nesting/public-landing
 * Body: { landing_public: boolean }
 */
export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    if (typeof body.landing_public !== 'boolean') {
      return NextResponse.json({ error: 'landing_public (boolean) is required' }, { status: 400 })
    }
    const row = await setNestingLandingPublic({
      landing_public: body.landing_public,
      wallet: session.wallet,
    })
    if (!row) {
      return NextResponse.json({ error: 'Could not update nesting public landing' }, { status: 500 })
    }
    return NextResponse.json(row)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
