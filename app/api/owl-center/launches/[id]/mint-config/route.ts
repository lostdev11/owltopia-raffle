import { NextRequest, NextResponse } from 'next/server'

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { buildMintDetailsPatchFromBody, bodyHasMintConfigFields } from '@/lib/owl-center/launch-mint-config-patch'
import { syncLaunchHubCoverImage } from '@/lib/owl-center/launch-cover-image'
import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-mint-config-get:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  return NextResponse.json({ ok: true, launch, editor })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-mint-config-patch:${ip}`, 30, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const coverRaw = body.cover_image_url ?? body.image_url
  let updated = launch
  let hasMintFields = false

  if (bodyHasMintConfigFields(body)) {
    const patch = buildMintDetailsPatchFromBody(body, launch)
    if ('error' in patch) return jsonError(patch.error, 400)
    hasMintFields = true
    updated = (await updateOwlCenterLaunchByIdAdmin(id, patch)) ?? launch
  }

  if (coverRaw !== undefined) {
    if (coverRaw === null || coverRaw === '') {
      updated = (await updateOwlCenterLaunchByIdAdmin(id, { image_url: null })) ?? updated
    } else if (typeof coverRaw === 'string') {
      updated = (await syncLaunchHubCoverImage(id, coverRaw)) ?? updated
    }
  }

  if (!updated) return jsonError('Update failed', 500)
  if (!hasMintFields && coverRaw === undefined) return jsonError('No fields to update', 400)

  const db = getSupabaseAdmin()
  await db.from('owl_center_activity_logs').insert({
    launch_id: id,
    message:
      coverRaw !== undefined && !hasMintFields
        ? 'Hub card cover updated'
        : editor.isAdmin && !editor.isCreator
          ? 'Mint details updated (admin)'
          : 'Mint details updated (creator)',
    event_type: 'system',
  })

  return NextResponse.json({ ok: true, launch: updated })
}
