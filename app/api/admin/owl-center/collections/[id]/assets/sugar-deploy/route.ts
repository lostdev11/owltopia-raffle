import { NextRequest, NextResponse } from 'next/server'

import {
  getSugarDeployStatusForLaunch,
  registerManualSugarDeployIds,
  runOnchainSugarDeployForLaunch,
} from '@/lib/owl-center/sugar-deploy-worker'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * GET — Phase B deploy readiness (Arweave done? CM IDs saved? can deploy from server?)
 * POST — action: deploy_onchain | register_ids | sync_from_cache
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const status = await getSugarDeployStatusForLaunch(id)
  if (!status.launch) return jsonError('Launch not found', 404)

  return NextResponse.json({
    arweave_ready: status.arweave_ready,
    can_deploy: status.can_deploy,
    onchain_deploy_enabled: status.onchain_deploy_enabled,
    server_deploy_max_supply: status.server_deploy_max_supply,
    candy_machine_id: status.candy_machine_id,
    collection_mint: status.collection_mint,
    deploy_state: status.deploy_state,
    mint_mode: status.launch.mint_mode,
    terminal_command: `npm run sugar:deploy -- collections/${sanitizeFolderHint(status.launch.name)}`,
  })
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-sugar-deploy:${ip}`, 10, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  let body: {
    action?: string
    candy_machine_id?: string
    collection_mint?: string
    candy_guard_id?: string
    cache?: {
      program?: { candyMachine?: string; collectionMint?: string; candyGuard?: string }
    }
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const action = body.action?.trim().toLowerCase() ?? 'deploy_onchain'

  if (action === 'register_ids') {
    const result = await registerManualSugarDeployIds(
      id,
      body.candy_machine_id ?? '',
      body.collection_mint ?? '',
      body.candy_guard_id
    )
    if (!result.ok) return jsonError(result.error, 400)
    return NextResponse.json({ ok: true, result })
  }

  if (action === 'sync_from_cache') {
    const cache = body.cache
    const cm = typeof cache?.program?.candyMachine === 'string' ? cache.program.candyMachine : ''
    const col = typeof cache?.program?.collectionMint === 'string' ? cache.program.collectionMint : ''
    const guard = typeof cache?.program?.candyGuard === 'string' ? cache.program.candyGuard : undefined
    if (!cm.trim() || !col.trim()) {
      return jsonError(
        'cache.json is missing program.candyMachine or program.collectionMint — run sugar deploy first.',
        400
      )
    }
    const result = await registerManualSugarDeployIds(id, cm, col, guard)
    if (!result.ok) return jsonError(result.error, 400)
    return NextResponse.json({ ok: true, result })
  }

  if (action !== 'deploy_onchain') {
    return jsonError('Invalid action — use deploy_onchain, register_ids, or sync_from_cache', 400)
  }

  const result = await runOnchainSugarDeployForLaunch(id)
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : 400
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status })
  }

  return NextResponse.json({ ok: true, result })
}

function sanitizeFolderHint(name: string): string {
  return (name || 'collection')
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'collection'
}
