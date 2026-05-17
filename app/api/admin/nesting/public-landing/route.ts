import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getNestingPublicSettings,
  patchNestingPublicSettings,
} from '@/lib/db/nesting-public-settings'
import { isNestingEnvKillSwitchEnabled } from '@/lib/nesting/policy'
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
    return NextResponse.json({
      ...row,
      nesting_env_kill_switch: isNestingEnvKillSwitchEnabled(),
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/nesting/public-landing
 * Body: { landing_public?: boolean, nesting_operations_paused?: boolean } — at least one field required.
 */
export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const hasLanding = typeof body.landing_public === 'boolean'
    const hasOpsPaused = typeof body.nesting_operations_paused === 'boolean'
    if (!hasLanding && !hasOpsPaused) {
      return NextResponse.json(
        { error: 'Provide landing_public and/or nesting_operations_paused (boolean)' },
        { status: 400 }
      )
    }
    const row = await patchNestingPublicSettings({
      wallet: session.wallet,
      ...(hasLanding ? { landing_public: body.landing_public } : {}),
      ...(hasOpsPaused ? { nesting_operations_paused: body.nesting_operations_paused } : {}),
    })
    if (!row) {
      return NextResponse.json({ error: 'Could not update nesting public landing' }, { status: 500 })
    }
    return NextResponse.json({
      ...row,
      nesting_env_kill_switch: isNestingEnvKillSwitchEnabled(),
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
