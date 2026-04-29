import { NextRequest, NextResponse } from 'next/server'
import { normalizeReferralCodeInput } from '@/lib/referrals/code-format'
import { REFERRAL_COOKIE_NAME } from '@/lib/referrals/constants'
import {
  isReferralAttributionEnabled,
  isReferralComplimentaryTicketEnabled,
} from '@/lib/referrals/config'
import { hasConfirmedReferralComplimentaryGlobally } from '@/lib/db/entries'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * GET /api/referrals/session?wallet=optional
 * Lets the client show “free first ticket” UX without reading the httpOnly referral cookie.
 * When `wallet` is a valid Solana address, `complimentaryLifetimeAvailable` is false if that
 * wallet already redeemed its one global free referral ticket.
 */
export async function GET(request: NextRequest) {
  const raw = request.cookies.get(REFERRAL_COOKIE_NAME)?.value ?? ''
  const code = normalizeReferralCodeInput(raw)
  const showComplimentaryHint =
    isReferralAttributionEnabled() &&
    isReferralComplimentaryTicketEnabled() &&
    code != null &&
    code.length > 0

  const walletRaw = request.nextUrl.searchParams.get('wallet')
  const walletNorm = walletRaw ? normalizeSolanaWalletAddress(walletRaw) : null
  let complimentaryLifetimeAvailable: boolean | undefined
  if (walletNorm) {
    complimentaryLifetimeAvailable = !(await hasConfirmedReferralComplimentaryGlobally(walletNorm))
  }

  return NextResponse.json({
    showComplimentaryHint,
    ...(walletNorm ? { complimentaryLifetimeAvailable } : {}),
  })
}
