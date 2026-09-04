import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getCoinArtUpgradeSettings,
  patchCoinArtUpgradeSettings,
} from '@/lib/db/coin-art-upgrade-settings'
import { coinArtUpgradeEnvStatus, isCoinArtUpgradeEnabled } from '@/lib/coin-upgrade/config'
import { parseOr400 } from '@/lib/validations'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  upgrades_enabled: z.boolean(),
})

/**
 * GET /api/admin/coin-upgrade/settings
 * Current admin toggle + env override status.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const [settings, enabled] = await Promise.all([
      getCoinArtUpgradeSettings(),
      isCoinArtUpgradeEnabled(),
    ])
    return NextResponse.json({
      settings,
      enabled,
      env: coinArtUpgradeEnvStatus(),
    })
  } catch (e) {
    console.error('[admin/coin-upgrade/settings GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/coin-upgrade/settings
 * Body: { upgrades_enabled: boolean }
 */
export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(patchSchema, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: 'Provide upgrades_enabled (boolean)' }, { status: 400 })
    }

    const settings = await patchCoinArtUpgradeSettings({
      wallet: session.wallet,
      upgrades_enabled: parsed.data.upgrades_enabled,
    })
    if (!settings) {
      return NextResponse.json({ error: 'Could not update coin art upgrade settings' }, { status: 500 })
    }

    const enabled = await isCoinArtUpgradeEnabled()
    return NextResponse.json({
      settings,
      enabled,
      env: coinArtUpgradeEnvStatus(),
    })
  } catch (e) {
    console.error('[admin/coin-upgrade/settings PATCH]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
