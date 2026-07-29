import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { isAdmin } from '@/lib/db/admins'
import { resolveSplMintOnChain } from '@/lib/solana/resolve-spl-mint'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/partners/nest-applications/verify-mint?mint=…
 * Partner/admin helper: confirm a reward token mint exists on-chain as SPL / Token-2022.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  try {
    const [feeTier, admin] = await Promise.all([
      getCreatorFeeTier(session.wallet, { skipCache: true }),
      isAdmin(session.wallet),
    ])
    if (feeTier.reason !== 'partner_community' && !admin) {
      return NextResponse.json({ error: 'Partner program access required.' }, { status: 403 })
    }

    const mint = request.nextUrl.searchParams.get('mint')?.trim() ?? ''
    const resolved = await resolveSplMintOnChain(mint)
    if (!resolved.ok) {
      return NextResponse.json({ valid: false, error: resolved.error }, { status: 400 })
    }
    return NextResponse.json({
      valid: true,
      mint: resolved.mint.mint,
      decimals: resolved.mint.decimals,
      program: resolved.mint.program,
      supply: resolved.mint.supply,
    })
  } catch (e) {
    console.error('[partners/nest-applications/verify-mint GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
