import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getPackPublicSettings,
  setPackAccessMode,
  type PackAccessMode,
} from '@/lib/db/pack-public-settings'
import { isPacksEnvKillSwitch } from '@/lib/packs/access'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const row = await getPackPublicSettings()
    const accessMode: PackAccessMode = row?.access_mode ?? 'restricted'
    const killSwitch = isPacksEnvKillSwitch()
    return NextResponse.json({
      accessMode,
      killSwitch,
      effectivePublic: !killSwitch && accessMode === 'public',
      updatedAt: row?.updated_at ?? null,
      updatedByWallet: row?.updated_by_wallet ?? null,
    })
  } catch (e) {
    console.error('[admin packs launch] GET', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load launch settings' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))
    const mode = body.access_mode
    if (mode !== 'public' && mode !== 'restricted') {
      return NextResponse.json(
        { error: 'access_mode must be public or restricted' },
        { status: 400 }
      )
    }

    const updated = await setPackAccessMode({
      access_mode: mode,
      wallet: session.wallet,
    })
    if (!updated) {
      return NextResponse.json({ error: 'Failed to update launch mode' }, { status: 500 })
    }

    const killSwitch = isPacksEnvKillSwitch()
    return NextResponse.json({
      ok: true,
      accessMode: updated.access_mode,
      killSwitch,
      effectivePublic: !killSwitch && updated.access_mode === 'public',
      updatedAt: updated.updated_at,
      updatedByWallet: updated.updated_by_wallet,
    })
  } catch (e) {
    console.error('[admin packs launch] PATCH', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Update failed' },
      { status: 500 }
    )
  }
}
