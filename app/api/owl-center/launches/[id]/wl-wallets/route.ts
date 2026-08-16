import { NextRequest, NextResponse } from 'next/server'

import {
  bulkUpsertLaunchWlWallets,
  listLaunchWlWallets,
  parseWlWalletText,
  removeLaunchWlWallet,
} from '@/lib/db/owl-center-launch-wl-wallets'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { launchHasWhitelistProgram } from '@/lib/owl-center/launch-wl-window'
import {
  normalizePhaseKey,
  resolvePartnerAllowlistPhases,
} from '@/lib/owl-center/partner-allowlist-phases'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function resolvePhaseKey(
  launch: Parameters<typeof resolvePartnerAllowlistPhases>[0],
  raw: string | null | undefined
): string | { error: string } {
  const phases = resolvePartnerAllowlistPhases(launch)
  const requested = raw?.trim() ? normalizePhaseKey(raw) : ''
  if (requested) {
    if (phases.length > 0 && !phases.some((p) => p.key === requested)) {
      return { error: `Unknown allowlist phase "${requested}". Save mint details phases first.` }
    }
    return requested
  }
  return phases[0]?.key ?? 'wl'
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-wl-get:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  const phases = resolvePartnerAllowlistPhases(launch)
  const phaseParam = request.nextUrl.searchParams.get('phase')
  const phaseResolved = resolvePhaseKey(launch, phaseParam)
  if (typeof phaseResolved === 'object') return jsonError(phaseResolved.error, 400)

  const rows = await listLaunchWlWallets(id, phaseResolved)
  const total_allowed = rows.reduce((s, r) => s + r.allowed_mints, 0)
  const total_used = rows.reduce((s, r) => s + r.used_mints, 0)

  return NextResponse.json({
    ok: true,
    launch_id: id,
    wl_enabled: launchHasWhitelistProgram(launch),
    wl_supply: launch.wl_supply,
    phase_key: phaseResolved,
    phases,
    rows,
    wallet_count: rows.length,
    total_allowed,
    total_used,
  })
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-wl-post:${ip}`, 30, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  if (!launchHasWhitelistProgram(launch)) {
    return jsonError(
      'Add at least one allowlist phase in Mint details (Show Advanced) before adding wallets.',
      400
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const phaseResolved = resolvePhaseKey(
    launch,
    typeof body.phase_key === 'string' ? body.phase_key : typeof body.phase === 'string' ? body.phase : null
  )
  if (typeof phaseResolved === 'object') return jsonError(phaseResolved.error, 400)

  const defaultAllowed = Math.max(1, Math.floor(Number(body.allowed_mints ?? 1) || 1))
  const note = typeof body.note === 'string' ? body.note : null

  let wallets: Array<{ wallet: string; allowed_mints?: number; note?: string | null }> = []
  if (typeof body.text === 'string' && body.text.trim()) {
    wallets = parseWlWalletText(body.text).map((wallet) => ({
      wallet,
      allowed_mints: defaultAllowed,
      note,
    }))
  } else if (Array.isArray(body.wallets)) {
    for (const raw of body.wallets) {
      if (typeof raw === 'string') {
        wallets.push({ wallet: raw, allowed_mints: defaultAllowed, note })
      } else if (raw && typeof raw === 'object') {
        const row = raw as Record<string, unknown>
        if (typeof row.wallet === 'string') {
          wallets.push({
            wallet: row.wallet,
            allowed_mints:
              row.allowed_mints != null ? Math.max(1, Math.floor(Number(row.allowed_mints) || 1)) : defaultAllowed,
            note: typeof row.note === 'string' ? row.note : note,
          })
        }
      }
    }
  }

  if (wallets.length < 1) return jsonError('Paste at least one Solana wallet address', 400)
  if (wallets.length > 2000) return jsonError('Max 2000 wallets per upload', 400)

  const result = await bulkUpsertLaunchWlWallets({
    launchId: id,
    phaseKey: phaseResolved,
    wallets,
    createdByWallet: editor.wallet,
  })

  return NextResponse.json({
    ok: true,
    phase_key: phaseResolved,
    upserted: result.upserted,
    failed: result.failed,
  })
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-wl-del:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  const wallet = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
  const phaseResolved = resolvePhaseKey(launch, request.nextUrl.searchParams.get('phase'))
  if (typeof phaseResolved === 'object') return jsonError(phaseResolved.error, 400)

  const result = await removeLaunchWlWallet(id, wallet, phaseResolved)
  if (!result.ok) return jsonError(result.error, 400)
  return NextResponse.json({ ok: true, phase_key: phaseResolved })
}
