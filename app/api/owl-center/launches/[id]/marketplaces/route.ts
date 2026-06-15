import { NextRequest, NextResponse } from 'next/server'

import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { isLaunchMarketplaceListingUnlocked } from '@/lib/owl-center/launch-marketplace-eligibility'
import { ensureSelloutMarketplacePrepIfNeeded } from '@/lib/owl-center/sellout-marketplace-prep'
import {
  ensureMarketplaceRow,
  getMarketplaceReadinessByLaunchId,
  syncLaunchMarketplaceFieldsFromRow,
  upsertMarketplaceReadinessForLaunch,
} from '@/lib/db/owl-center-marketplace'
import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import type { OwlCenterPhase, OwlCenterStatus } from '@/lib/owl-center/types'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Creator-scoped marketplace readiness (read + post-listing updates). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-creator-mp:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  const listingUnlocked = isLaunchMarketplaceListingUnlocked(launch)
  if (listingUnlocked) {
    await ensureSelloutMarketplacePrepIfNeeded(launch)
  }

  let row = await getMarketplaceReadinessByLaunchId(id)
  if (!row) row = await ensureMarketplaceRow(id)

  const launchFresh = await getOwlCenterLaunchByIdAdmin(id)
  return NextResponse.json({
    launch: launchFresh,
    marketplaceReadiness: row,
    listing_unlocked: listingUnlocked,
  })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-creator-mp:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  if (!isLaunchMarketplaceListingUnlocked(launch)) {
    return jsonError(
      'Marketplace listing unlocks after sell-out. Finish minting your collection first.',
      403
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const action = typeof body.action === 'string' ? body.action : ''

  const pickStr = (key: string): string | null | undefined => {
    if (!(key in body)) return undefined
    const v = body[key]
    if (v === null) return null
    if (typeof v !== 'string') return undefined
    const t = v.trim()
    return t === '' ? null : t.slice(0, 4000)
  }

  const patch: Parameters<typeof upsertMarketplaceReadinessForLaunch>[1] = {}

  const s = (key: string) => pickStr(key)
  if (s('magic_eden_url') !== undefined) patch.magic_eden_url = s('magic_eden_url') ?? null
  if (s('tensor_url') !== undefined) patch.tensor_url = s('tensor_url') ?? null
  if ('notes' in body && typeof body.notes === 'string') patch.notes = body.notes.slice(0, 8000) || null

  if ('trading_links_active' in body && typeof body.trading_links_active === 'boolean') {
    patch.trading_links_active = body.trading_links_active
  }

  if (action === 'mark_me_listed') {
    patch.magic_eden_status = 'LISTED'
  }
  if (action === 'mark_tensor_listed') {
    patch.tensor_status = 'LISTED'
  }
  if (action === 'activate_trading_links') {
    patch.trading_links_active = true
  }

  if (!Object.keys(patch).length && !action) {
    return jsonError('No changes', 400)
  }

  const updated = await upsertMarketplaceReadinessForLaunch(id, patch)
  if (!updated) return jsonError('Save failed', 500)

  await syncLaunchMarketplaceFieldsFromRow(id, updated)

  const confirmTrading =
    body.confirm_trading_transition === true || body.confirm_trading_transition === 'true'
  if (confirmTrading && updated.trading_links_active) {
    if (launch.status === 'SOLD_OUT' || launch.active_phase === 'SOLD_OUT') {
      const nextStatus: OwlCenterStatus = 'TRADING_ACTIVE'
      const nextPhase: OwlCenterPhase = 'TRADING_ACTIVE'
      await updateOwlCenterLaunchByIdAdmin(id, { status: nextStatus, active_phase: nextPhase })
    } else {
      return jsonError('Collection must be sold out before trading goes live.', 400)
    }
  }

  const launchFresh = await getOwlCenterLaunchByIdAdmin(id)
  const row = (await getMarketplaceReadinessByLaunchId(id)) ?? updated

  return NextResponse.json({ launch: launchFresh, marketplaceReadiness: row, listing_unlocked: true })
}
