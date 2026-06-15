import { NextRequest, NextResponse } from 'next/server'

import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import {
  assessCreatorLaunchDeleteEligibility,
} from '@/lib/owl-center/creator-launch-delete'
import { deleteOwlCenterLaunchByIdAdmin, getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-delete:${ip}`, 10, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  const eligibility = assessCreatorLaunchDeleteEligibility(launch)
  if (!eligibility.deletable) {
    return jsonError(eligibility.reason ?? 'This collection cannot be deleted.', 409)
  }

  let body: Record<string, unknown> = {}
  try {
    const raw = await request.text()
    if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const confirmName = typeof body.confirm_name === 'string' ? body.confirm_name.trim() : ''
  if (!confirmName || confirmName !== launch.name.trim()) {
    return jsonError('Type the exact collection name to confirm deletion.', 400)
  }

  const deleted = await deleteOwlCenterLaunchByIdAdmin(id)
  if (!deleted) return jsonError('Delete failed', 500)

  return NextResponse.json({ ok: true, deleted_id: id })
}
