import { NextRequest, NextResponse } from 'next/server'

import { isOwlVisionAdmin } from '@/lib/admin/access'
import { requireSession } from '@/lib/auth-server'
import { isApprovedOwlCenterPartner } from '@/lib/db/owl-center-partners'
import { listOwlCenterLaunchesAdmin, listOwlCenterLaunchesByCreatorWallet } from '@/lib/db/owl-center-launch'
import { assessCreatorLaunchDeleteEligibility } from '@/lib/owl-center/creator-launch-delete'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-my-launches:${ip}`, 30, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) {
    return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
  }

  const isAdmin = await isOwlVisionAdmin(wallet)
  const isPartner = isAdmin ? false : await isApprovedOwlCenterPartner(wallet)
  const rows = isAdmin
    ? (await listOwlCenterLaunchesAdmin()).filter((l) => l.slug !== 'gen2')
    : await listOwlCenterLaunchesByCreatorWallet(wallet)

  return NextResponse.json({
    ok: true,
    wallet,
    isAdmin,
    isPartner,
    launches: rows.map((l) => {
      const deleteEligibility = assessCreatorLaunchDeleteEligibility(l)
      return {
        id: l.id,
        slug: l.slug,
        name: l.name,
        symbol: l.symbol,
        status: l.status,
        active_phase: l.active_phase,
        total_supply: l.total_supply,
        minted_count: l.minted_count,
        wallet_mint_limit: l.wallet_mint_limit,
        updated_at: l.updated_at,
        deletable: deleteEligibility.deletable,
        delete_block_reason: deleteEligibility.reason,
      }
    }),
  })
}
