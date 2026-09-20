import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getPackPublicSettings,
  setPackAccessMode,
  setPackOwlCheckoutEnabled,
  type PackAccessMode,
} from '@/lib/db/pack-public-settings'
import { isPacksEnvKillSwitch } from '@/lib/packs/access'
import { PACK_OWL_USD_FEE, PACK_PRICE_OWL } from '@/lib/packs/config'

export const dynamic = 'force-dynamic'

function launchPayload(row: Awaited<ReturnType<typeof getPackPublicSettings>>) {
  const accessMode: PackAccessMode = row?.access_mode ?? 'restricted'
  const killSwitch = isPacksEnvKillSwitch()
  return {
    accessMode,
    owlCheckoutEnabled: row?.owl_checkout_enabled === true,
    owlCheckout: {
      priceOwl: PACK_PRICE_OWL,
      usdFee: PACK_OWL_USD_FEE,
      label: `${PACK_PRICE_OWL} $OWL + $${PACK_OWL_USD_FEE} SOL fee → vault`,
    },
    killSwitch,
    effectivePublic: !killSwitch && accessMode === 'public',
    updatedAt: row?.updated_at ?? null,
    updatedByWallet: row?.updated_by_wallet ?? null,
  }
}

export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const row = await getPackPublicSettings()
    return NextResponse.json(launchPayload(row))
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
    const hasMode = body.access_mode === 'public' || body.access_mode === 'restricted'
    const hasOwl =
      typeof body.owl_checkout_enabled === 'boolean' ||
      typeof body.owlCheckoutEnabled === 'boolean'

    if (!hasMode && !hasOwl) {
      return NextResponse.json(
        {
          error:
            'Provide access_mode (public|restricted) and/or owl_checkout_enabled (boolean)',
        },
        { status: 400 }
      )
    }

    let row = await getPackPublicSettings()

    if (hasMode) {
      const updated = await setPackAccessMode({
        access_mode: body.access_mode as PackAccessMode,
        wallet: session.wallet,
      })
      if (!updated) {
        return NextResponse.json({ error: 'Failed to update launch mode' }, { status: 500 })
      }
      row = updated
    }

    if (hasOwl) {
      const enabled =
        typeof body.owl_checkout_enabled === 'boolean'
          ? body.owl_checkout_enabled
          : Boolean(body.owlCheckoutEnabled)
      const updated = await setPackOwlCheckoutEnabled({
        enabled,
        wallet: session.wallet,
      })
      if (!updated) {
        return NextResponse.json(
          { error: 'Failed to update $OWL checkout setting' },
          { status: 500 }
        )
      }
      row = updated
    }

    return NextResponse.json({
      ok: true,
      ...launchPayload(row),
    })
  } catch (e) {
    console.error('[admin packs launch] PATCH', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Update failed' },
      { status: 500 }
    )
  }
}
