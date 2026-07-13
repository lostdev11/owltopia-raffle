import { NextRequest, NextResponse } from 'next/server'

import {
  deleteGeneratorProjectForWallet,
  getGeneratorProjectByWallet,
  upsertGeneratorProjectForWallet,
} from '@/lib/db/owl-center-generator-project'
import { getSessionFromRequest } from '@/lib/auth-server'
import { getOwlCenterLaunchAccess } from '@/lib/owl-center/launch-access'
import {
  MAX_GENERATOR_PROJECT_BYTES,
  projectJsonByteSize,
  validateGeneratorProjectPayload,
} from '@/lib/owl-center/generator/project-serialize'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Load wallet-scoped generator project from cloud. */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-gen-get:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const session = getSessionFromRequest(request)
  if (!session?.wallet) return jsonError('Sign in required', 401)

  const access = await getOwlCenterLaunchAccess(request)
  if (!access) return jsonError('Approved partner or admin access required', 403)

  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) return jsonError('Invalid session wallet', 401)

  const row = await getGeneratorProjectByWallet(wallet)
  if (!row) return NextResponse.json({ ok: true, project: null })

  return NextResponse.json({
    ok: true,
    project: row.project_json,
    cloud_updated_at: row.updated_at,
    name: row.name,
  })
}

/** Save generator project to cloud (one project per wallet). */
export async function PUT(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-gen-put:${ip}`, 30, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const session = getSessionFromRequest(request)
  if (!session?.wallet) return jsonError('Sign in required', 401)

  const access = await getOwlCenterLaunchAccess(request)
  if (!access) return jsonError('Approved partner or admin access required', 403)

  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) return jsonError('Invalid session wallet', 401)

  const rawText = await request.text()
  if (rawText.length > MAX_GENERATOR_PROJECT_BYTES) {
    return jsonError(`Project too large — max ${Math.round(MAX_GENERATOR_PROJECT_BYTES / 1024 / 1024)}MB`, 413)
  }

  let body: unknown
  try {
    body = JSON.parse(rawText) as unknown
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const parsed = validateGeneratorProjectPayload((body as { project?: unknown }).project ?? body)
  if (!parsed.ok) return jsonError(parsed.error, 400)

  if (projectJsonByteSize(parsed.project) > MAX_GENERATOR_PROJECT_BYTES) {
    return jsonError('Project too large — remove some layers or use smaller PNGs', 413)
  }

  const result = await upsertGeneratorProjectForWallet(wallet, parsed.project)
  if (!result.ok) return jsonError(result.error, 500)

  return NextResponse.json({ ok: true, updated_at: result.updated_at })
}

/** Clear cloud copy (local browser copy unaffected). */
export async function DELETE(request: NextRequest) {
  const session = getSessionFromRequest(request)
  if (!session?.wallet) return jsonError('Sign in required', 401)

  const access = await getOwlCenterLaunchAccess(request)
  if (!access) return jsonError('Approved partner or admin access required', 403)

  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) return jsonError('Invalid session wallet', 401)

  await deleteGeneratorProjectForWallet(wallet)
  return NextResponse.json({ ok: true })
}
