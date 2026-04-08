import { NextRequest, NextResponse } from 'next/server'
import {
  createRaffle,
  findNonTerminalRaffleByCreatorAndPrizeMint,
  generateUniqueSlug,
  getRaffleCreationCountForCreatorToday,
  getRafflesViaRest,
  promoteDraftRafflesToLive,
} from '@/lib/db/raffles'
import { enrichRafflesWithCreatorHolder } from '@/lib/raffles/enrich-raffles-with-holder'
import { getSessionFromRequest, requireSession } from '@/lib/auth-server'
import { isOwlEnabled } from '@/lib/tokens'
import { PublicKey } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'
import { getNftHolderInWallet } from '@/lib/solana/wallet-tokens'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import type { Raffle } from '@/lib/types'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getAdminRole } from '@/lib/db/admins'
import { filterRafflesByPendingVisibility } from '@/lib/raffles/visibility'
import { getPrizeEscrowPublicKey } from '@/lib/raffles/prize-escrow'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { notifyRaffleCreated } from '@/lib/discord-raffle-webhooks'
import {
  parseNftFloorPrice,
  parseNftTicketPrice,
  computeNftMinTicketsFromFloorAndTicket,
  validateNftMaxTickets,
  validateNftMinTicketsNotOverCap,
} from '@/lib/raffles/nft-raffle-economics'
import { isNftBurntPerHeliusDas } from '@/lib/helius-das-burn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Vercel Pro serverless cap (seconds). Hobby is 10s; keep routes deployable on either tier by not relying on >10s in critical paths without testing. */
export const maxDuration = 60

// POST create path: stay under ~10s of work so Hobby (10s cap) still returns JSON; Pro allows 60s wall clock.
const SUPABASE_TIMEOUT_MS = 7_000

/** Wrap a promise with a timeout; rejects with step info so we can return 502 + step */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  step: 'timeout' | 'supabase error'
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms)
  })
  try {
    const result = await Promise.race([promise, timeoutPromise])
    if (timeoutId) clearTimeout(timeoutId)
    return result
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId)
    const e = err as Error & { step?: 'timeout' | 'supabase error' }
    e.step = e.message?.includes('timed out') ? 'timeout' : step
    throw e
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') === 'true'

    const session = getSessionFromRequest(request)
    const viewerWallet = session?.wallet ?? null
    const viewerIsAdmin = viewerWallet ? (await getAdminRole(viewerWallet)) !== null : false

    await promoteDraftRafflesToLive()

    const { data: raffles, error } = await getRafflesViaRest(activeOnly, {
      includeDraft: true,
      timeoutMs: 12_000,
      maxRetries: 1,
      perAttemptMs: 8_000,
    })

    if (error) {
      const isConfig = error.code === 'CONFIG'
      const isUpstreamUnavailable =
        isConfig || /503|service unavailable|connection|timeout|missing/i.test(error.message)
      const status = isUpstreamUnavailable ? 503 : 502
      const bodyMessage =
        status === 503
          ? isConfig
            ? 'Raffles service is not configured. Please try again later.'
            : 'Service temporarily unavailable. Please try again in a moment.'
          : safeErrorMessage(error)
      console.error('[GET /api/raffles]', error.code ?? 'error', error.message)
      return NextResponse.json(
        { error: bodyMessage, step: error.code === 'TIMEOUT' ? 'timeout' : isConfig ? 'config' : 'supabase error' },
        { status }
      )
    }

    const filtered = filterRafflesByPendingVisibility(raffles ?? [], viewerWallet, viewerIsAdmin)
    // Cap holder enrichment so a huge unique-creator count cannot run unbounded (Pro maxDuration is still finite).
    const enriched = await enrichRafflesWithCreatorHolder(filtered, { budgetMs: 45_000 })
    return NextResponse.json(enriched, { status: 200 })
  } catch (err) {
    console.error('[GET /api/raffles] unexpected error:', err)
    return NextResponse.json(
      { error: safeErrorMessage(err), step: 'supabase error' },
      { status: 502 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`raffles:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json()
    
    // Validate required fields
    const requiredFields = ['title', 'ticket_price', 'end_time']
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        )
      }
    }
    
    const walletAddress = session.wallet

    const walletCreateRl = rateLimit(`raffles:create:${walletAddress}`, 6, 60_000)
    if (!walletCreateRl.allowed) {
      return NextResponse.json(
        { error: 'Too many create attempts. Wait a minute and try again.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    // Generate slug from title if not provided, or use provided slug
    let slug = body.slug
    if (!slug) {
      // Generate base slug from title
      slug = body.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
    }
    
    // Ensure slug is unique
    slug = await withTimeout(generateUniqueSlug(slug), SUPABASE_TIMEOUT_MS, 'supabase error')
    
    // Default start_time to current time if not provided
    const startTime = body.start_time || new Date().toISOString()

    // Validate date strings are valid ISO format
    const startDate = new Date(startTime)
    const endDate = new Date(body.end_time)
    
    if (isNaN(startDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid start_time format. Expected ISO 8601 format.' },
        { status: 400 }
      )
    }
    
    if (isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid end_time format. Expected ISO 8601 format.' },
        { status: 400 }
      )
    }
    
    // Validate that end_time is after start_time
    if (endDate <= startDate) {
      return NextResponse.json(
        { error: 'end_time must be after start_time' },
        { status: 400 }
      )
    }
    
    // Validate that raffle duration does not exceed 7 days
    const durationMs = endDate.getTime() - startDate.getTime()
    const durationDays = durationMs / (1000 * 60 * 60 * 24)
    if (durationDays > 7) {
      return NextResponse.json(
        { error: 'Raffle duration cannot exceed 7 days' },
        { status: 400 }
      )
    }

    // Validate currency: SOL, USDC, and OWL when enabled
    const validCurrencies = ['USDC', 'SOL', ...(isOwlEnabled() ? ['OWL'] : [])]
    if (body.currency && !validCurrencies.includes(body.currency)) {
      const message = body.currency === 'OWL' && !isOwlEnabled()
        ? 'OWL is not enabled on this server. Set NEXT_PUBLIC_OWL_MINT_ADDRESS in your environment to use OWL, or choose SOL or USDC.'
        : `Currency must be one of: ${validCurrencies.join(', ')}`
      return NextResponse.json(
        { error: message },
        { status: 400 }
      )
    }

    // Creating raffles is NFT-only for now.
    if (body.prize_type && body.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'Only NFT raffles can be created right now.' },
        { status: 400 }
      )
    }
    const prizeType: 'nft' = 'nft'
    const prizeAmount: number | null = null
    const prizeCurrency: string | null = null

    // For NFT prizes, ensure at least one identifier is provided
    const nftMintAddress = body.nft_mint_address || null
    const nftTokenId = body.nft_token_id || null

    if (!nftMintAddress && !nftTokenId) {
      return NextResponse.json(
        { error: 'NFT prizes require either nft_mint_address or nft_token_id' },
        { status: 400 }
      )
    }

    const prizeAssetId = String(nftMintAddress || nftTokenId || '').trim()
    if (prizeAssetId && (await isNftBurntPerHeliusDas(prizeAssetId))) {
      return NextResponse.json(
        {
          error:
            'This NFT has been burned and cannot be used as a prize. Refresh your wallet NFT list and choose a different asset.',
        },
        { status: 400 }
      )
    }

    // Only block creation when the prize is SPL/Token-2022 and only held in a delegated (staked) account.
    if (nftMintAddress) {
      try {
        const mintPk = new PublicKey(nftMintAddress)
        const creatorPk = new PublicKey(walletAddress)
        const holder = await getNftHolderInWallet(getSolanaConnection(), mintPk, creatorPk, 'confirmed')
        if (holder && 'delegated' in holder && holder.delegated) {
          return NextResponse.json(
            {
              error:
                'This NFT is staked or delegated. Unstake it before creating a raffle—otherwise it cannot be sent to escrow.',
            },
            { status: 400 }
          )
        }
      } catch {
        // Invalid mint or transient RPC: allow create (deposit flow will surface issues).
      }
    }

    let maxTickets: number | null = null
    if (body.max_tickets != null && body.max_tickets !== '') {
      const parsed =
        typeof body.max_tickets === 'number' ? body.max_tickets : parseInt(String(body.max_tickets), 10)
      if (isNaN(parsed) || parsed <= 0) {
        return NextResponse.json({ error: 'max_tickets must be a positive integer when set.' }, { status: 400 })
      }
      maxTickets = parsed
    }

    // New NFT raffles only (POST): set min_tickets from floor ÷ ticket. Existing live listings are never updated here.
    const fpParsed = parseNftFloorPrice(body.floor_price)
    if (!fpParsed.ok) {
      return NextResponse.json({ error: fpParsed.error }, { status: 400 })
    }
    const tpParsed = parseNftTicketPrice(body.ticket_price)
    if (!tpParsed.ok) {
      return NextResponse.json({ error: tpParsed.error }, { status: 400 })
    }
    const ticketPriceNum = tpParsed.value
    const minTickets = computeNftMinTicketsFromFloorAndTicket(fpParsed.value, ticketPriceNum)
    const capCheck = validateNftMinTicketsNotOverCap(minTickets)
    if (!capCheck.ok) {
      return NextResponse.json({ error: capCheck.error }, { status: 400 })
    }
    const maxCheck = validateNftMaxTickets(maxTickets, minTickets)
    if (!maxCheck.ok) {
      return NextResponse.json({ error: maxCheck.error }, { status: 400 })
    }

    // Daily hosting limit: holders (Owltopia NFT) 3/day, non-holders 1/day (UTC day). Admins: no limit.
    const adminRole = await getAdminRole(walletAddress)

    if (adminRole === null && prizeAssetId) {
      const existingForPrize = await withTimeout(
        findNonTerminalRaffleByCreatorAndPrizeMint(walletAddress, prizeAssetId),
        SUPABASE_TIMEOUT_MS,
        'supabase error'
      )
      if (existingForPrize) {
        return NextResponse.json(
          {
            error:
              'You already have a raffle using this NFT. Open that listing or wait until it is completed or cancelled before creating another with the same prize.',
            existing_slug: existingForPrize.slug,
          },
          { status: 409 }
        )
      }
    }

    if (adminRole === null) {
      const feeTier = await getCreatorFeeTier(walletAddress, { skipCache: true })
      const isHolder = isOwlEnabled() && feeTier.reason === 'holder'
      const maxRafflesPerDay = isHolder ? 3 : 1
      const createdToday = await withTimeout(
        getRaffleCreationCountForCreatorToday(walletAddress),
        SUPABASE_TIMEOUT_MS,
        'supabase error'
      )
      if (createdToday >= maxRafflesPerDay) {
        const message = isHolder
          ? 'Owltopia holders can host up to 3 raffles per day. You’ve reached today’s limit. Try again tomorrow (UTC).'
          : 'You can host 1 raffle per day. Owltopia (Owl NFT) holders can host up to 3. Try again tomorrow (UTC).'
        return NextResponse.json(
          { error: message },
          { status: 429 }
        )
      }
    }

    // Parse optional metadata fields
    const rank = body.rank && body.rank.trim() ? body.rank.trim() : null
    const floorPrice = fpParsed.string

    // Build raffle data - only include NFT fields if this is an NFT prize
    const raffleData: Omit<Raffle, 'id' | 'created_at' | 'updated_at'> = {
      slug: slug, // Use the generated unique slug
      title: body.title,
      description: body.description || null,
      image_url: body.image_url || null,
      image_fallback_url:
        typeof body.image_fallback_url === 'string' && body.image_fallback_url.trim()
          ? body.image_fallback_url.trim()
          : null,
      prize_type: prizeType,
      prize_amount: prizeAmount,
      prize_currency: prizeCurrency,
      // Only include NFT fields if prize_type is 'nft' or if explicitly provided
      nft_mint_address: prizeType === 'nft' ? nftMintAddress : null,
      nft_collection_name: prizeType === 'nft' ? (body.nft_collection_name || null) : null,
      nft_token_id: prizeType === 'nft' ? nftTokenId : null,
      nft_metadata_uri: prizeType === 'nft' ? (body.nft_metadata_uri || null) : null,
      ticket_price: ticketPriceNum,
      currency: body.currency || 'SOL',
      max_tickets: maxTickets,
      min_tickets: minTickets,
      start_time: startTime,
      end_time: body.end_time,
      original_end_time: body.end_time, // Store original end time when raffle is created
      time_extension_count: 0,
      theme_accent: body.theme_accent || 'prime',
      edited_after_entries: false,
      created_by: walletAddress,
      creator_wallet: walletAddress,
      // NFT raffles stay inactive until prize is in escrow (verify-prize-deposit sets is_active).
      is_active: false,
      winner_wallet: null,
      winner_selected_at: null,
      status: 'draft',
      nft_transfer_transaction: null,
      fee_bps_applied: null,
      fee_tier_reason: null,
      platform_fee_amount: null,
      creator_payout_amount: null,
      settled_at: null,
      rank: rank,
      floor_price: floorPrice,
      prize_deposited_at: null,
      prize_deposit_tx: null,
      cancellation_requested_at: null,
      cancelled_at: null,
      cancellation_fee_amount: null,
      cancellation_fee_currency: null,
      cancellation_refund_policy: null,
      prize_returned_at: null,
      prize_return_reason: null,
      prize_return_tx: null,
      ticket_payments_to_funds_escrow: true,
      nft_escrow_address_snapshot: getPrizeEscrowPublicKey(),
      funds_escrow_address_snapshot: getFundsEscrowPublicKey(),
      creator_claimed_at: null,
      creator_claim_tx: null,
      creator_funds_claim_locked_at: null,
    }

    const raffle = await withTimeout(createRaffle(raffleData), SUPABASE_TIMEOUT_MS, 'supabase error')

    await notifyRaffleCreated(raffle)

    return NextResponse.json(raffle, { status: 201 })
  } catch (error) {
    console.error('Error creating raffle:', error)
    const err = error as Error & { step?: 'timeout' | 'supabase error' }
    const step = err.step ?? 'supabase error'
    return NextResponse.json(
      { error: safeErrorMessage(err), step },
      { status: 502 }
    )
  }
}
