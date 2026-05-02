import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getGen2PresaleSettings, setGen2PresaleLive } from '@/lib/db/gen2-presale-settings'

export const dynamic = 'force-dynamic'

/** GET — current presale live toggle (Gen2 admin only). */
export async function GET(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const row = await getGen2PresaleSettings()
    return NextResponse.json(row)
  } catch (error) {
    console.error('admin gen2-presale settings GET:', error)
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

/** PATCH — body `{ "is_live": boolean }` */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as { is_live?: unknown }
    if (typeof body.is_live !== 'boolean') {
      return NextResponse.json({ error: 'Body must include is_live (boolean)' }, { status: 400 })
    }

    const row = await setGen2PresaleLive(body.is_live, session.wallet)
    if (!row) {
      return NextResponse.json(
        { error: 'Could not save. Apply migration 094_gen2_presale_settings.sql if this table is missing.' },
        { status: 500 }
      )
    }

    return NextResponse.json(row)
  } catch (error) {
    console.error('admin gen2-presale settings PATCH:', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
