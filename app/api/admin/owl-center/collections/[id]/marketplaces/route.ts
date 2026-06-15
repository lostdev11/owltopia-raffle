import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { OWL_CENTER_MARKETPLACE_STATUSES, type OwlCenterMarketplaceTrackStatus } from '@/lib/owl-center/asset-types'
import {
  ensureMarketplaceRow,
  getMarketplaceReadinessByLaunchId,
  syncLaunchMarketplaceFieldsFromRow,
  upsertMarketplaceReadinessForLaunch,
} from '@/lib/db/owl-center-marketplace'
import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { promoteLaunchToLive } from '@/lib/owl-center/launch-go-live'
import type { OwlCenterPhase, OwlCenterStatus } from '@/lib/owl-center/types'
import { validateOptionalSolanaPubkeyInput } from '@/lib/solana/validate-pubkey'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function parseStatus(v: unknown): OwlCenterMarketplaceTrackStatus | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.toUpperCase() as OwlCenterMarketplaceTrackStatus
  return OWL_CENTER_MARKETPLACE_STATUSES.includes(s) ? s : undefined
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  let row = await getMarketplaceReadinessByLaunchId(id)
  if (!row) row = await ensureMarketplaceRow(id)

  return NextResponse.json({ launch, marketplaceReadiness: row })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-mp:${ip}`, 120, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

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
  if (s('collection_mint') !== undefined) {
    const v = validateOptionalSolanaPubkeyInput(s('collection_mint'), 'Collection mint')
    if (!v.ok) return jsonError(v.error, 400)
    patch.collection_mint = v.pubkey
  }
  if (s('candy_machine_id') !== undefined) {
    const v = validateOptionalSolanaPubkeyInput(s('candy_machine_id'), 'Candy Machine ID')
    if (!v.ok) return jsonError(v.error, 400)
    patch.candy_machine_id = v.pubkey
  }
  if (s('hash_list_url') !== undefined) patch.hash_list_url = s('hash_list_url') ?? null
  if (s('magic_eden_url') !== undefined) patch.magic_eden_url = s('magic_eden_url') ?? null
  if (s('tensor_url') !== undefined) patch.tensor_url = s('tensor_url') ?? null
  if ('notes' in body && typeof body.notes === 'string') patch.notes = body.notes.slice(0, 8000) || null

  if ('trading_links_active' in body && typeof body.trading_links_active === 'boolean') {
    patch.trading_links_active = body.trading_links_active
  }

  const ms = parseStatus(body.metadata_status)
  if (ms) patch.metadata_status = ms
  const vs = parseStatus(body.verified_collection_status)
  if (vs) patch.verified_collection_status = vs
  const me = parseStatus(body.magic_eden_status)
  if (me) patch.magic_eden_status = me
  const te = parseStatus(body.tensor_status)
  if (te) patch.tensor_status = te

  if (action === 'mark_ready_indexing') {
    patch.metadata_status = 'READY_FOR_INDEXING'
    patch.magic_eden_status = 'READY_FOR_INDEXING'
    patch.tensor_status = 'READY_FOR_INDEXING'
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

  const updated = await upsertMarketplaceReadinessForLaunch(id, patch)
  if (!updated) return jsonError('Save failed', 500)

  let row = updated
  await syncLaunchMarketplaceFieldsFromRow(id, row)

  let go_live: Awaited<ReturnType<typeof promoteLaunchToLive>> | null = null
  const autoGoLive = body.auto_go_live !== false
  if (autoGoLive && (patch.candy_machine_id || patch.collection_mint || action)) {
    go_live = await promoteLaunchToLive(id, { auto: true })
  }

  const confirmTrading =
    body.confirm_trading_transition === true || body.confirm_trading_transition === 'true'
  const forceTrading = body.force_trading_transition === true || body.force_trading_transition === 'true'
  if (confirmTrading && row.trading_links_active) {
    const nextStatus: OwlCenterStatus = 'TRADING_ACTIVE'
    const nextPhase: OwlCenterPhase = 'TRADING_ACTIVE'
    if (launch.status === 'SOLD_OUT' || forceTrading) {
      await updateOwlCenterLaunchByIdAdmin(id, { status: nextStatus, active_phase: nextPhase })
    } else {
      return jsonError(
        'Launch must be SOLD_OUT before TRADING_ACTIVE, or pass force_trading_transition for admin override.',
        400
      )
    }
  }

  const launchFresh = await getOwlCenterLaunchByIdAdmin(id)
  row = (await getMarketplaceReadinessByLaunchId(id)) ?? row

  return NextResponse.json({ launch: launchFresh, marketplaceReadiness: row, go_live })
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return PATCH(request, context)
}
