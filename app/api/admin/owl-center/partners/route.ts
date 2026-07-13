import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import {
  listOwlCenterPartners,
  setOwlCenterPartnerStatus,
  upsertOwlCenterPartner,
} from '@/lib/db/owl-center-partners'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** GET /api/admin/owl-center/partners — all launchpad partner wallets. */
export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-partners:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const partners = await listOwlCenterPartners()
  return NextResponse.json({ ok: true, partners })
}

/** POST /api/admin/owl-center/partners — approve a partner wallet { wallet, label?, notes? }. */
export async function POST(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const wallet = normalizeSolanaWalletAddress(typeof body.wallet === 'string' ? body.wallet : '')
  if (!wallet) return jsonError('Enter a valid Solana wallet address', 400)

  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null

  const partner = await upsertOwlCenterPartner({
    wallet,
    label,
    notes,
    addedByWallet: session.wallet,
  })
  if (!partner) return jsonError('Save failed', 500)

  return NextResponse.json({ ok: true, partner })
}

/** PATCH /api/admin/owl-center/partners — { id, status: 'approved' | 'revoked' }. */
export async function PATCH(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const status = body.status === 'revoked' ? 'revoked' : body.status === 'approved' ? 'approved' : null
  if (!id || !status) return jsonError('id and status (approved | revoked) required', 400)

  const partner = await setOwlCenterPartnerStatus(id, status)
  if (!partner) return jsonError('Update failed', 500)

  return NextResponse.json({ ok: true, partner })
}
