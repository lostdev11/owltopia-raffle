import { NextRequest, NextResponse } from 'next/server'

import { isOwlVisionAdmin } from '@/lib/admin/access'
import { getSessionFromRequest } from '@/lib/auth-server'
import { isApprovedOwlCenterPartner } from '@/lib/db/owl-center-partners'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/owl-center/launch-access[?wallet=...]
 * Whether the SIWS session (or, as a UI hint, the connected wallet) may use
 * launchpad tools — Owl Vision admin or approved launchpad partner.
 * Write APIs always re-check the session server-side.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-access:${ip}`, 60, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const sessionWallet = normalizeSolanaWalletAddress(getSessionFromRequest(request)?.wallet ?? '')
  const queryWallet = normalizeSolanaWalletAddress(request.nextUrl.searchParams.get('wallet') ?? '')
  const wallet = sessionWallet || queryWallet

  if (!wallet) {
    return NextResponse.json({ ok: true, isAdmin: false, isPartner: false, signedIn: false })
  }

  const isAdmin = await isOwlVisionAdmin(wallet)
  const isPartner = isAdmin ? false : await isApprovedOwlCenterPartner(wallet)

  return NextResponse.json({
    ok: true,
    isAdmin,
    isPartner,
    signedIn: !!sessionWallet,
  })
}
