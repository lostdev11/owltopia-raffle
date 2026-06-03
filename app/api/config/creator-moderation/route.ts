import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth-server'
import { isAdmin } from '@/lib/db/admins'
import { getCreatorModerationCreateContext } from '@/lib/db/creator-moderation'
import { listingFeeSolForStrikeCount } from '@/lib/raffles/creator-moderation-policy'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'

export const dynamic = 'force-dynamic'

/**
 * GET /api/config/creator-moderation
 * Returns blacklist status and listing deposit tier for the signed-in creator (create form).
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request)
    if (!session?.wallet) {
      return NextResponse.json({
        blacklisted: false,
        banned: false,
        strikeCount: 0,
        listingFeeLamports: null,
        listingFeeSol: null,
        treasury: getRaffleTreasuryWalletAddress(),
        isAdmin: false,
      })
    }

    const admin = await isAdmin(session.wallet)
    if (admin) {
      return NextResponse.json({
        blacklisted: false,
        banned: false,
        strikeCount: 0,
        listingFeeLamports: null,
        listingFeeSol: null,
        treasury: getRaffleTreasuryWalletAddress(),
        isAdmin: true,
      })
    }

    const ctx = await getCreatorModerationCreateContext(session.wallet)
    return NextResponse.json({
      blacklisted: ctx.blacklisted,
      banned: ctx.banned,
      strikeCount: ctx.strikeCount,
      listingFeeLamports: ctx.listingFeeLamports,
      listingFeeSol: ctx.blacklisted ? listingFeeSolForStrikeCount(ctx.strikeCount) : null,
      reason: ctx.reason,
      treasury: getRaffleTreasuryWalletAddress(),
      isAdmin: false,
    })
  } catch {
    return NextResponse.json({
      blacklisted: false,
      banned: false,
      strikeCount: 0,
      listingFeeLamports: null,
      listingFeeSol: null,
      treasury: getRaffleTreasuryWalletAddress(),
      isAdmin: false,
    })
  }
}
