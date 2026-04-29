import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  createEntry,
  getPendingEntryIdsForWalletAndRaffle,
  hasConfirmedEntryForWalletInRaffle,
  hasConfirmedReferralComplimentaryGlobally,
} from '@/lib/db/entries'
import { getRaffleById, getEntriesByRaffleId, upgradeRaffleToFundsEscrowIfEligible } from '@/lib/db/raffles'
import { hasAnyInVerification } from '@/lib/verify-in-flight'
import { isOwlEnabled, getTokenInfo } from '@/lib/tokens'
import { entriesCreateBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getPaymentSplit } from '@/lib/raffles/split-at-purchase'
import { nftRaffleExemptFromEscrowRequirement } from '@/lib/raffles/visibility'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { resolveReferralForPurchase } from '@/lib/db/referrals'
import { REFERRAL_COOKIE_NAME } from '@/lib/referrals/constants'
import { isReferralAttributionEnabled, isReferralComplimentaryTicketEnabled } from '@/lib/referrals/config'

// Force dynamic rendering since we use request body
export const dynamic = 'force-dynamic'

// Single generic error for all failures — no signal to attackers (rate limit, state, etc.)
const ERROR_BODY = { success: false as const, error: 'server error' }

/**
 * Create a new entry (pending) and return payment details for transaction generation.
 * Responses are minimal and non-informative to prevent exploit reconnaissance.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`entries-create:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    let body: unknown
    try {
      const text = await request.text()
      if (!text?.trim()) {
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }
      body = JSON.parse(text) as unknown
    } catch {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const parsed = parseOr400(entriesCreateBody, body)
    if (!parsed.ok) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }
    const { raffleId: raffleIdStr, walletAddress: walletAddressStr, ticketQuantity: ticketQuantityNum } = parsed.data

    // Attribution uses httpOnly cookie only (set by GET /api/referrals/capture); never trust JSON body.
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

    const walletRl = rateLimit(`entries-create:wallet:${walletAddressStr}`, 10, 60_000)
    if (!walletRl.allowed) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    let raffle = await getRaffleById(raffleIdStr)
    if (!raffle) {
      return NextResponse.json(ERROR_BODY, { status: 404 })
    }

    await upgradeRaffleToFundsEscrowIfEligible(raffleIdStr)
    raffle = await getRaffleById(raffleIdStr)
    if (!raffle) {
      return NextResponse.json(ERROR_BODY, { status: 404 })
    }

    if (!raffle.is_active) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    // NFT raffles: block purchases until prize is verified in escrow (defense in depth)
    if (
      raffle.prize_type === 'nft' &&
      !raffle.prize_deposited_at &&
      !nftRaffleExemptFromEscrowRequirement(raffle)
    ) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    // Admin-flagged: block purchases (e.g. NFT not in escrow, wrong link, dispute)
    const purchasesBlockedAt = (raffle as { purchases_blocked_at?: string | null }).purchases_blocked_at
    if (purchasesBlockedAt) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (new Date(raffle.end_time) <= new Date()) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (raffle.currency === 'OWL' && !isOwlEnabled()) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[entries/create] OWL raffle checkout blocked: NEXT_PUBLIC_OWL_MINT_ADDRESS not set')
      }
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    // Coerce DB numerics (can be string from Supabase) so logic works for all clients (desktop + mobile)
    const ticketPrice = Number(raffle.ticket_price)
    if (!Number.isFinite(ticketPrice) || ticketPrice <= 0) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (raffle.max_tickets != null) {
      const maxTickets = Number(raffle.max_tickets)
      if (Number.isFinite(maxTickets) && maxTickets > 0) {
        const allEntries = await getEntriesByRaffleId(raffle.id)
        const totalConfirmedTickets = allEntries
          .filter(e => e.status === 'confirmed')
          .reduce((sum, e) => sum + Number(e.ticket_quantity), 0)
        if (totalConfirmedTickets + ticketQuantityNum > maxTickets) {
          return NextResponse.json(ERROR_BODY, { status: 400 })
        }
      }
    }

    const fullPrice = ticketPrice * ticketQuantityNum
    if (!Number.isFinite(fullPrice) || fullPrice <= 0) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (referralRaw) {
      const refIpRl = rateLimit(`entries-create:ref-ip:${ip}`, 8, 60_000)
      if (!refIpRl.allowed) {
        return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
      }
      const refWalletRl = rateLimit(`entries-create:ref-wallet:${walletAddressStr}`, 8, 60_000)
      if (!refWalletRl.allowed) {
        return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
      }
    }

    const hadConfirmed = await hasConfirmedEntryForWalletInRaffle(raffleIdStr, walletAddressStr)
    const alreadyUsedGlobalFreeTicket =
      await hasConfirmedReferralComplimentaryGlobally(walletAddressStr)
    const eligibleComplimentary =
      isReferralComplimentaryTicketEnabled() &&
      isReferralAttributionEnabled() &&
      ticketQuantityNum === 1 &&
      Boolean(referralRaw) &&
      !hadConfirmed &&
      !alreadyUsedGlobalFreeTicket

    const referralResolution = await resolveReferralForPurchase(referralRaw, walletAddressStr, {
      amountPaid: fullPrice,
      currency: String(raffle.currency || 'SOL'),
      complimentary: eligibleComplimentary,
    })

    const useComplimentary = Boolean(eligibleComplimentary && referralResolution)
    const finalAmountPaid = useComplimentary ? 0 : fullPrice

    const complimentaryTokenPlain = useComplimentary ? randomBytes(24).toString('base64url') : null
    const complimentaryExpiresAt = useComplimentary
      ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
      : null

    // Do not invalidate (reset) a pending entry that is currently being verified.
    // Entry must only be "released" after verification completes (race-condition hardening).
    const pendingIds = await getPendingEntryIdsForWalletAndRaffle(
      raffleIdStr,
      walletAddressStr
    )
    if (pendingIds.length > 0 && hasAnyInVerification(pendingIds)) {
      return NextResponse.json(
        ERROR_BODY,
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    // Create pending entry
    const entry = await createEntry({
      raffle_id: raffleIdStr,
      wallet_address: walletAddressStr,
      ticket_quantity: ticketQuantityNum,
      transaction_signature: null,
      status: 'pending',
      amount_paid: finalAmountPaid,
      currency: raffle.currency,
      ...(referralResolution
        ? {
            referrer_wallet: referralResolution.referrerWallet,
            referral_code_used: referralResolution.referralCodeUsed,
          }
        : {}),
      ...(useComplimentary && complimentaryTokenPlain && complimentaryExpiresAt
        ? {
            referral_complimentary: true,
            complimentary_confirm_token: complimentaryTokenPlain,
            complimentary_token_expires_at: complimentaryExpiresAt,
          }
        : {}),
    })

    if (!entry) {
      return NextResponse.json(ERROR_BODY, { status: 500 })
    }

    if (useComplimentary && complimentaryTokenPlain) {
      return NextResponse.json({
        success: true,
        entryId: entry.id,
        complimentary: true,
        complimentaryToken: complimentaryTokenPlain,
      })
    }

    const treasuryWallet = process.env.RAFFLE_RECIPIENT_WALLET || process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET
    if (!treasuryWallet) {
      return NextResponse.json(ERROR_BODY, { status: 500 })
    }

    const tokenInfo = getTokenInfo(raffle.currency as 'SOL' | 'USDC' | 'OWL')
    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const payToFundsEscrow = raffleUsesFundsEscrow(raffle)
    const fundsEscrowAddr =
      (raffle.funds_escrow_address_snapshot?.trim() || getFundsEscrowPublicKey()) ?? ''
    if (payToFundsEscrow && !fundsEscrowAddr) {
      return NextResponse.json(ERROR_BODY, { status: 500 })
    }

    let paymentDetails: {
      recipient: string
      amount: number
      currency: string
      usdcMint: string
      owlMint: string | null
      tokenDecimals: number
      split?: { recipient: string; amount: number }[]
    }

    if (payToFundsEscrow) {
      paymentDetails = {
        recipient: fundsEscrowAddr,
        amount: finalAmountPaid,
        currency: raffle.currency,
        usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        owlMint: tokenInfo.mintAddress,
        tokenDecimals: tokenInfo.decimals,
      }
    } else if (creatorWallet) {
      const { toCreator, toTreasury } = await getPaymentSplit(finalAmountPaid, creatorWallet)
      paymentDetails = {
        recipient: creatorWallet,
        amount: finalAmountPaid,
        currency: raffle.currency,
        usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        owlMint: tokenInfo.mintAddress,
        tokenDecimals: tokenInfo.decimals,
        split: [
          { recipient: creatorWallet, amount: toCreator },
          { recipient: treasuryWallet, amount: toTreasury },
        ],
      }
    } else {
      paymentDetails = {
        recipient: treasuryWallet,
        amount: finalAmountPaid,
        currency: raffle.currency,
        usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        owlMint: tokenInfo.mintAddress,
        tokenDecimals: tokenInfo.decimals,
      }
    }

    return NextResponse.json({
      success: true,
      entryId: entry.id,
      paymentDetails,
    })
  } catch (error) {
    console.error('Error creating entry:', error)
    return NextResponse.json(ERROR_BODY, { status: 500 })
  }
}
