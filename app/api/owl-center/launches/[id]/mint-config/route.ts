import { NextRequest, NextResponse } from 'next/server'

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { buildMintDetailsPatchFromBody, bodyHasMintConfigFields } from '@/lib/owl-center/launch-mint-config-patch'
import { syncLaunchHubCoverImage } from '@/lib/owl-center/launch-cover-image'
import { getAssetPackageByLaunchId, upsertAssetPackageForLaunch } from '@/lib/db/owl-center-asset-package'
import { getOwlCenterLaunchByIdAdmin, updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { syncPublicSimpleCandyGuards } from '@/lib/owl-center/sync-public-simple-guards'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function safeGuardSync(updated: Awaited<ReturnType<typeof getOwlCenterLaunchByIdAdmin>>) {
  if (!updated || updated.mint_mode !== 'public_simple') return { guard_sync: null, warning: null as string | null }
  try {
    return { guard_sync: await syncPublicSimpleCandyGuards(updated), warning: null as string | null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('creator mint-config guard sync failed', message)
    return {
      guard_sync: { ok: false as const, error: message },
      warning: `Candy Guard sync failed: ${message}`,
    }
  }
}

async function safeWriteActivityLog(entry: {
  launch_id: string
  message: string
  event_type: string
}) {
  try {
    const db = getSupabaseAdmin()
    const { error } = await db.from('owl_center_activity_logs').insert(entry)
    if (error) throw error
    return null
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('creator mint-config activity log failed', message)
    return `Activity log write failed: ${message}`
  }
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

  const warnings: string[] = []
  const { guard_sync, warning: guardWarning } = hasMintFields
    ? await safeGuardSync(updated)
    : { guard_sync: null, warning: null as string | null }
  if (guardWarning) warnings.push(guardWarning)
  if (hasMintFields && updated.total_supply !== launch.total_supply) {
    try {
      const existing = await getAssetPackageByLaunchId(id)
      if (existing) {
        await upsertAssetPackageForLaunch(id, { expected_supply: updated.total_supply })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('creator mint-config asset package sync failed', message)
      warnings.push(`Asset package sync failed: ${message}`)
    }
  }

  const logWarning = await safeWriteActivityLog({
    launch_id: id,
    message:
      coverRaw !== undefined && !hasMintFields
        ? 'Hub card cover updated'
        : editor.isAdmin && !editor.isCreator
          ? 'Mint details updated (admin)'
          : 'Mint details updated (creator)',
    event_type: 'system',
  })
  if (logWarning) warnings.push(logWarning)

  return NextResponse.json({ ok: true, launch: updated, guard_sync, warnings })
}
