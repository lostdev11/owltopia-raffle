import { NextRequest, NextResponse } from 'next/server'

import { getGeneratorProjectByProjectId, getGeneratorProjectByWallet } from '@/lib/db/owl-center-generator-project'
import { getOwlCenterLaunchBySlugAdmin, updateOwlCenterLaunchAdmin } from '@/lib/db/owl-center-launch'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getSessionFromRequest } from '@/lib/auth-server'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function gen2LinkPayload() {
  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) return null

  let linked_project_name: string | null = null
  if (launch.generator_project_id) {
    const row = await getGeneratorProjectByProjectId(launch.generator_project_id)
    linked_project_name = row?.name ?? null
  }

  return {
    ok: true,
    launch_id: launch.id,
    generator_project_id: launch.generator_project_id,
    total_supply: launch.total_supply,
    linked_project_name,
    assets_admin_url: `/admin/owl-center/collections/${launch.id}/assets`,
  }
}

/** GET — Gen2 ↔ generator link state */
export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const payload = await gen2LinkPayload()
  if (!payload) return jsonError('Gen2 launch not found', 404)
  return NextResponse.json(payload)
}

/** POST — set or clear generator_project_id on Gen2 launch */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-gen2-gen-link:${ip}`, 30, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  let body: { generator_project_id?: string | null; use_cloud_project?: boolean }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  let projectId: string | null = null

  if (body.use_cloud_project) {
    const auth = getSessionFromRequest(request)
    const wallet = auth?.wallet ? normalizeSolanaWalletAddress(auth.wallet) : null
    if (!wallet) return jsonError('Connect wallet to link your cloud generator project', 401)
    const row = await getGeneratorProjectByWallet(wallet)
    if (!row) return jsonError('No cloud generator project — save one in Owl Generator first', 400)
    projectId = row.project_id
  } else if (body.generator_project_id === null) {
    projectId = null
  } else if (typeof body.generator_project_id === 'string') {
    projectId = body.generator_project_id.trim() || null
  } else {
    return jsonError('Pass generator_project_id or use_cloud_project: true', 400)
  }

  const updated = await updateOwlCenterLaunchAdmin('gen2', { generator_project_id: projectId })
  if (!updated) return jsonError('Update failed', 500)

  const payload = await gen2LinkPayload()
  return NextResponse.json(payload ?? { ok: true })
}
