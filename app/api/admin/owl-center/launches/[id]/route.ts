import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
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
