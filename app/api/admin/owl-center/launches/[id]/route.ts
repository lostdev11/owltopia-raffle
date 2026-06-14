import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { bodyHasMintConfigFields, buildMintDetailsPatchFromBody } from '@/lib/owl-center/launch-mint-config-patch'
import { datetimeLocalToIso, parsePhaseSchedule } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterPhase, OwlCenterStatus } from '@/lib/owl-center/types'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-launch-patch:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const patch: Parameters<typeof updateOwlCenterLaunchByIdAdmin>[1] = {}

  if (typeof body.name === 'string') patch.name = body.name.trim().slice(0, 120)
  if (typeof body.description === 'string') patch.description = body.description.slice(0, 4000)
  if (typeof body.is_paused === 'boolean') patch.is_paused = body.is_paused
  if (typeof body.is_featured === 'boolean') patch.is_featured = body.is_featured
  if (typeof body.candy_machine_id === 'string') patch.candy_machine_id = body.candy_machine_id.trim() || null
  if (typeof body.collection_mint === 'string') patch.collection_mint = body.collection_mint.trim() || null
  if (typeof body.devnet_candy_machine_id === 'string') {
    patch.devnet_candy_machine_id = body.devnet_candy_machine_id.trim() || null
  }
  if (typeof body.devnet_collection_mint === 'string') {
    patch.devnet_collection_mint = body.devnet_collection_mint.trim() || null
  }
  if (typeof body.magic_eden_url === 'string') patch.magic_eden_url = body.magic_eden_url.trim() || null
  if (typeof body.tensor_url === 'string') patch.tensor_url = body.tensor_url.trim() || null
  if (body.mint_network === 'devnet' || body.mint_network === 'mainnet') {
    patch.mint_network = body.mint_network
  }
  if (typeof body.active_phase === 'string') patch.active_phase = body.active_phase as OwlCenterPhase
  if (typeof body.status === 'string') patch.status = body.status as OwlCenterStatus
  if (body.public_price_usdc != null) patch.public_price_usdc = Number(body.public_price_usdc)
  if (body.wallet_mint_limit != null) patch.wallet_mint_limit = Number(body.wallet_mint_limit)
  if (body.total_supply != null) {
    const n = Number(body.total_supply)
    if (Number.isInteger(n) && n >= 1 && n <= 50_000) patch.total_supply = n
  }
  if (body.public_supply != null) {
    const n = Number(body.public_supply)
    if (Number.isInteger(n) && n >= 0 && n <= 50_000) patch.public_supply = n
  }
  if (typeof body.mint_mode === 'string') {
    if (body.mint_mode === 'public_simple' || body.mint_mode === 'gen2_full') {
      patch.mint_mode = body.mint_mode
    }
  }
  if (body.launch_deadline_at === null) patch.launch_deadline_at = null
  else if (typeof body.launch_deadline_at === 'string') {
    const trimmed = body.launch_deadline_at.trim()
    if (!trimmed) patch.launch_deadline_at = null
    else {
      const iso =
        datetimeLocalToIso(trimmed) ??
        (Number.isFinite(new Date(trimmed).getTime()) ? new Date(trimmed).toISOString() : null)
      if (iso) patch.launch_deadline_at = iso
    }
  }
  if (body.phase_schedule !== undefined) {
    patch.phase_schedule = parsePhaseSchedule(body.phase_schedule) as Record<string, string>
  }

  if (bodyHasMintConfigFields(body)) {
    const mintPatch = buildMintDetailsPatchFromBody(body, launch)
    if ('error' in mintPatch) return jsonError(mintPatch.error, 400)
    Object.assign(patch, mintPatch)
  }

  const updated = await updateOwlCenterLaunchByIdAdmin(id, patch)
  if (!updated) return jsonError('Update failed', 500)

  return NextResponse.json({ ok: true, launch: updated })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  return NextResponse.json({ launch })
}
