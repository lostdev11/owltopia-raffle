import { NextRequest, NextResponse } from 'next/server'
import {
  createEntry,
  getPendingEntryIdsForWalletAndRaffle,
  hasPendingWithSavedSignatureForWalletRaffle,
} from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId, upgradeRaffleToFundsEscrowIfEligible } from '@/lib/db/raffles'
import { hasAnyInVerification } from '@/lib/verify-in-flight'
import { isOwlEnabled, getTokenInfo } from '@/lib/tokens'
import { entriesCreateBatchBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { nftRaffleExemptFromEscrowRequirement } from '@/lib/raffles/visibility'
import { resolveReferralForPurchase } from '@/lib/db/referrals'
import { REFERRAL_COOKIE_NAME } from '@/lib/referrals/constants'
import { isReferralAttributionEnabled } from '@/lib/referrals/config'
import { mergeBatchPayoutLines } from '@/lib/entries/batch-payout-lines'
import { isAdmin } from '@/lib/db/admins'
import {
  assertCartBatchGrossMatchesMergedSplit,
  CartBatchPaymentTotalMismatchError,
} from '@/lib/entries/batch-invariants'
import { bulkCheckoutRestrictedToAdmins } from '@/lib/cart/bulk-checkout-admin-only'

export const dynamic = 'force-dynamic'

const ERROR_BODY = { success: false as const, error: 'server error' }

const PAYMENT_IN_FLIGHT_BODY = {
  success: false as const,
  error:
    'A payment is already confirming for one of these raffles. Wait a moment, refresh the page, then try again — or finish checkout before starting another.',
}

/** Creates one or more pending paid entries (same currency only) + merged SPL/SOL payouts for one transaction. */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`entries-create-batch:${ip}`, 14, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    let body: unknown
    try {
      const text = await request.text()
      if (!text?.trim()) return NextResponse.json(ERROR_BODY, { status: 400 })
      body = JSON.parse(text) as unknown
    } catch {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const parsed = parseOr400(entriesCreateBatchBody, body)
    if (!parsed.ok) return NextResponse.json(ERROR_BODY, { status: 400 })
    const { walletAddress: walletAddressStr, items } = parsed.data

    if (bulkCheckoutRestrictedToAdmins()) {
      if (!(await isAdmin(walletAddressStr.trim()))) {
        return NextResponse.json(
          {
            success: false as const,
            code: 'admin_only' as const,
            error:
              'Multi-raffle cart checkout is paused for maintenance. Pay one raffle at a time, or try again later.',
          },
          { status: 403 }
        )
      }
    }

    const raffleIdsOrdered = items.map(it => it.raffleId)
    const idSet = new Set(raffleIdsOrdered)
    if (idSet.size !== raffleIdsOrdered.length) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    let referralRaw: string | undefined
    if (isReferralAttributionEnabled()) {
      const cookieRaw = request.cookies.get(REFERRAL_COOKIE_NAME)?.value?.trim()
      if (cookieRaw) {
        try {
          referralRaw = decodeURIComponent(cookieRaw)
        } catch {
          referralRaw = cookieRaw
        }
      }
    }

    const walletRl = rateLimit(`entries-create-batch:wallet:${walletAddressStr}`, 6, 60_000)
    if (!walletRl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const treasuryWallet = process.env.RAFFLE_RECIPIENT_WALLET || process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    if (!treasuryWallet?.trim()) {
      return NextResponse.json(ERROR_BODY, { status: 500 })
    }

    let unifiedCurrency: string | null = null
    const pairs: Array<{
      raffle: NonNullable<Awaited<ReturnType<typeof getRaffleById>>>
      entry: NonNullable<Awaited<ReturnType<typeof createEntry>>>
    }> = []

    for (const { raffleId: raffleIdStr, ticketQuantity: ticketQty } of items) {
      await upgradeRaffleToFundsEscrowIfEligible(raffleIdStr)

      let raffle = await getRaffleById(raffleIdStr)
      if (!raffle) return NextResponse.json(ERROR_BODY, { status: 404 })

      if (!raffle.is_active) return NextResponse.json(ERROR_BODY, { status: 400 })

      if (
        raffle.prize_type === 'nft' &&
        !raffle.prize_deposited_at &&
        !nftRaffleExemptFromEscrowRequirement(raffle)
      ) {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }

      const purchasesBlockedAt = (raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
      if (purchasesBlockedAt) return NextResponse.json(ERROR_BODY, { status: 400 })

      if (new Date(raffle.end_time) <= new Date()) return NextResponse.json(ERROR_BODY, { status: 400 })

      if (raffle.currency === 'OWL' && !isOwlEnabled()) {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }

      const c = String(raffle.currency || 'SOL')
      if (!unifiedCurrency) unifiedCurrency = c
      else if (unifiedCurrency !== c) return NextResponse.json(ERROR_BODY, { status: 400 })

      const ticketPrice = Number(raffle.ticket_price)
      if (!Number.isFinite(ticketPrice) || ticketPrice <= 0) {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }

      const ticketQuantityNum = Math.floor(Number(ticketQty))
      if (!(ticketQuantityNum >= 1)) return NextResponse.json(ERROR_BODY, { status: 400 })

      if (raffle.max_tickets != null) {
        const maxTickets = Number(raffle.max_tickets)
        if (Number.isFinite(maxTickets) && maxTickets > 0) {
          const allEntries = await getEntriesByRaffleId(raffle.id)
          const totalConfirmedTickets = allEntries
            .filter(e => e.status === 'confirmed')
            .reduce((sum, e) => sum + Number(e.ticket_quantity), 0)

          /** Include prior batch lines targeting this raffle earlier in THIS request only (unique raffle id per batch ⇒ 0 extra). */
          if (totalConfirmedTickets + ticketQuantityNum > maxTickets) {
            return NextResponse.json(ERROR_BODY, { status: 400 })
          }
        }
      }

      const fullPrice = ticketPrice * ticketQuantityNum
      if (!Number.isFinite(fullPrice) || fullPrice <= 0) return NextResponse.json(ERROR_BODY, { status: 400 })

      const pendingIds = await getPendingEntryIdsForWalletAndRaffle(raffleIdStr, walletAddressStr)
      if (pendingIds.length > 0 && hasAnyInVerification(pendingIds)) {
        return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
      }
      if (await hasPendingWithSavedSignatureForWalletRaffle(raffleIdStr, walletAddressStr)) {
        console.warn('[entries/create-batch] blocked: pending row has tx sig (payment in flight)', {
          raffleId: raffleIdStr,
        })
        return NextResponse.json(PAYMENT_IN_FLIGHT_BODY, { status: 409 })
      }

      /** Batch checkout never activates referral complimentary flows (would require separate tx-less confirm). */
      const referralResolution = await resolveReferralForPurchase(referralRaw, walletAddressStr, {
        amountPaid: fullPrice,
        currency: String(raffle.currency || 'SOL'),
        complimentary: false,
      })

      const entry = await createEntry({
        raffle_id: raffleIdStr,
        wallet_address: walletAddressStr,
        ticket_quantity: ticketQuantityNum,
        transaction_signature: null,
        status: 'pending',
        amount_paid: fullPrice,
        currency: raffle.currency,
        ...(referralResolution
          ? {
              referrer_wallet: referralResolution.referrerWallet,
              referral_code_used: referralResolution.referralCodeUsed,
            }
          : {}),
      })

      if (!entry) return NextResponse.json(ERROR_BODY, { status: 500 })

      pairs.push({ raffle, entry })
    }

    if (!unifiedCurrency) return NextResponse.json(ERROR_BODY, { status: 400 })

    const tokenInfo = getTokenInfo(unifiedCurrency as 'SOL' | 'USDC' | 'OWL')

    const mergedSplit = await mergeBatchPayoutLines({
      treasuryWallet,
      pairs: pairs.map(({ entry, raffle }) => ({ raffle, entry })),
    })

    try {
      assertCartBatchGrossMatchesMergedSplit({
        lineGrossAmounts: pairs.map(({ entry }) => Number(entry.amount_paid)),
        mergedSplit,
      })
    } catch (e) {
      if (e instanceof CartBatchPaymentTotalMismatchError) {
        console.error('[entries/create-batch] merged split vs line totals', e.sumLineGross, e.sumMergedAmounts)
        return NextResponse.json(ERROR_BODY, { status: 500 })
      }
      throw e
    }

    const paymentDetails = {
      currency: unifiedCurrency,
      usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      owlMint: tokenInfo.mintAddress,
      tokenDecimals: tokenInfo.decimals,
      split: mergedSplit,
    }

    return NextResponse.json({
      success: true,
      entryIds: pairs.map(({ entry }) => entry.id),
      paymentDetails,
    })
  } catch (e) {
    console.error('[entries/create-batch]', e)
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
