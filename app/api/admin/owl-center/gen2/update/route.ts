import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getOwlCenterLaunchBySlugAdmin, updateOwlCenterLaunchAdmin } from '@/lib/db/owl-center-launch'
import { datetimeLocalToIso, parseActivePhases, parsePhaseSchedule } from '@/lib/owl-center/phase-schedule'
import type { OwlCenterPhase, OwlCenterStatus } from '@/lib/owl-center/types'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const PHASES: OwlCenterPhase[] = [
  'AIRDROP',
  'PRESALE',
  'PRESALE_OVERAGE',
  'WHITELIST',
  'PUBLIC',
  'SOLD_OUT',
  'TRADING_ACTIVE',
]
const STATUSES: OwlCenterStatus[] = [
  'DRAFT',
  'PENDING_REVIEW',
  'PRESALE',
  'WHITELIST',
  'PUBLIC',
  'SOLD_OUT',
  'TRADING_ACTIVE',
]

export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-gen2-upd:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Parameters<typeof updateOwlCenterLaunchAdmin>[1] = {}

  if (typeof body.active_phase === 'string') {
    const p = body.active_phase.toUpperCase() as OwlCenterPhase
    if (!PHASES.includes(p)) return NextResponse.json({ error: 'Invalid active_phase' }, { status: 400 })
    patch.active_phase = p
  }
  if (body.active_phases !== undefined) {
    if (!Array.isArray(body.active_phases)) {
      return NextResponse.json({ error: 'Invalid active_phases' }, { status: 400 })
    }
    patch.active_phases = parseActivePhases(body.active_phases)
  }
  if (typeof body.status === 'string') {
    const s = body.status.toUpperCase() as OwlCenterStatus
    if (!STATUSES.includes(s)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    patch.status = s
  }
  if (typeof body.is_paused === 'boolean') patch.is_paused = body.is_paused
  if (body.candy_machine_id === null) patch.candy_machine_id = null
  else if (typeof body.candy_machine_id === 'string') patch.candy_machine_id = body.candy_machine_id.trim() || null
  if (body.collection_mint === null) patch.collection_mint = null
  else if (typeof body.collection_mint === 'string') patch.collection_mint = body.collection_mint.trim() || null
  if (body.devnet_candy_machine_id === null) patch.devnet_candy_machine_id = null
  else if (typeof body.devnet_candy_machine_id === 'string')
    patch.devnet_candy_machine_id = body.devnet_candy_machine_id.trim() || null
  if (body.devnet_collection_mint === null) patch.devnet_collection_mint = null
  else if (typeof body.devnet_collection_mint === 'string')
    patch.devnet_collection_mint = body.devnet_collection_mint.trim() || null
  if (body.magic_eden_url === null) patch.magic_eden_url = null
  else if (typeof body.magic_eden_url === 'string') patch.magic_eden_url = body.magic_eden_url.trim() || null
  if (body.tensor_url === null) patch.tensor_url = null
  else if (typeof body.tensor_url === 'string') patch.tensor_url = body.tensor_url.trim() || null
  if (body.minted_count !== undefined) {
    const n = Number(body.minted_count)
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json({ error: 'Invalid minted_count' }, { status: 400 })
    }
    const cur = await getOwlCenterLaunchBySlugAdmin('gen2')
    if (cur && n > cur.total_supply) {
      return NextResponse.json({ error: 'minted_count cannot exceed total_supply' }, { status: 400 })
    }
    patch.minted_count = n
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
  if (body.generator_project_id === null) patch.generator_project_id = null
  else if (typeof body.generator_project_id === 'string') {
    patch.generator_project_id = body.generator_project_id.trim() || null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  const updated = await updateOwlCenterLaunchAdmin('gen2', patch)
  if (!updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, launch: updated })
}
