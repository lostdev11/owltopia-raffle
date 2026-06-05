import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById } from '@/lib/db/raffles'
import { createEntry, getPendingEntryIdsForWalletAndRaffle } from '@/lib/db/entries'
import { getReferralRewardById } from '@/lib/db/referral-rewards'
import { raffleEligibleForReferralFreeEntry } from '@/lib/referrals/program'
import { resolveTicketPaymentCurrency } from '@/lib/raffles/dual-ticket-payment'
import { hasAnyInVerification } from '@/lib/verify-in-flight'
import { parseOr400 } from '@/lib/validations'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isReferralGrowthProgramActive } from '@/lib/referrals/config'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  rewardId: z.string().uuid(),
  raffleId: z.string().uuid(),
})

const ERROR_BODY = { success: false as const, error: 'server error' }

/**
 * POST /api/referrals/redeem-free-entry
 * Creates a pending complimentary entry for a pending referral reward.
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await isReferralGrowthProgramActive())) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`referral-redeem:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(bodySchema, body)
    if (!parsed.ok) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const { rewardId, raffleId } = parsed.data
    const wallet = session.wallet.trim()

    const reward = await getReferralRewardById(rewardId)
    if (!reward || reward.reward_status !== 'pending' || reward.reward_mode !== 'free_entry') {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const isBuyer = reward.reward_recipient_role === 'buyer' && reward.referred_wallet === wallet
    const isReferrer =
      reward.reward_recipient_role === 'referrer' && reward.referrer_wallet === wallet
    if (!isBuyer && !isReferrer) {
      return NextResponse.json(ERROR_BODY, { status: 403 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle || !raffleEligibleForReferralFreeEntry(raffle)) {
      return NextResponse.json(
        { success: false, error: 'This raffle is not eligible for free entry redemption.' },
        { status: 400 }
      )
    }

    const payCur = resolveTicketPaymentCurrency(raffle, undefined)
    if (!payCur) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const pendingIds = await getPendingEntryIdsForWalletAndRaffle(raffleId, wallet)
    if (pendingIds.length > 0 && hasAnyInVerification(pendingIds)) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const tokenPlain = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    const issuedAt = new Date().toISOString()

    const entry = await createEntry({
      raffle_id: raffleId,
      wallet_address: wallet,
      ticket_quantity: 1,
      transaction_signature: null,
      status: 'pending',
      amount_paid: 0,
      currency: payCur,
      referral_complimentary: true,
      complimentary_confirm_token: tokenPlain,
      complimentary_token_expires_at: expiresAt,
      referrer_wallet: reward.referrer_wallet,
      referral_code_used: reward.referral_code,
      reward_mode_at_issue: 'free_entry',
      reward_issued_at: issuedAt,
      reward_status: 'pending',
      referral_reward_id: reward.id,
    })

    if (!entry) {
      return NextResponse.json(ERROR_BODY, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      entryId: entry.id,
      complimentary: true,
      complimentaryToken: tokenPlain,
      rewardId: reward.id,
    })
  } catch (e) {
    console.error('[referrals/redeem-free-entry]', e instanceof Error ? e.message : e)
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
