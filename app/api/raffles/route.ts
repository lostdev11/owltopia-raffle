import { NextRequest, NextResponse } from 'next/server'
import { createRaffle, generateUniqueSlug, getRafflesViaRest, promoteDraftRafflesToLive } from '@/lib/db/raffles'
import { requireAdminSession } from '@/lib/auth-server'
import { isOwlEnabled } from '@/lib/tokens'
import type { Raffle } from '@/lib/types'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 10  // Vercel Hobby plan limit

// Timeout must be less than maxDuration (10s on Vercel) so we can return JSON before platform kills request
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

    await promoteDraftRafflesToLive()

    const { data: raffles, error } = await getRafflesViaRest(activeOnly, {
      includeDraft: true,
      timeoutMs: 5_000,
      maxRetries: 1,
      perAttemptMs: 3_000,
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

    return NextResponse.json(raffles, { status: 200 })
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
    const session = await requireAdminSession(request)
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

    // Determine prize_type based on provided fields
    // Default to 'crypto' unless NFT identifiers are explicitly provided
    let prizeType: 'crypto' | 'nft' = body.prize_type || 'crypto'
    if (!body.prize_type && (body.nft_mint_address || body.nft_token_id)) {
      prizeType = 'nft'
    }

    // Handle prize data based on type
    let prizeAmount: number | null = null
    let prizeCurrency: string | null = null
    let nftMintAddress: string | null = null
    let nftTokenId: string | null = null

    if (prizeType === 'crypto') {
      // For crypto prizes, use provided values or default to 0 with ticket currency
      prizeAmount = body.prize_amount !== undefined ? parseFloat(body.prize_amount) : 0
      prizeCurrency = body.prize_currency || body.currency || 'SOL'
    } else {
      // For NFT prizes, ensure at least one identifier is provided
      nftMintAddress = body.nft_mint_address || null
      nftTokenId = body.nft_token_id || null
      
      if (!nftMintAddress && !nftTokenId) {
        return NextResponse.json(
          { error: 'NFT prizes require either nft_mint_address or nft_token_id' },
          { status: 400 }
        )
      }
    }

    // Parse min_tickets safely - default to minTickets if both minTickets and minParticipants exist
    let minTickets: number | null = null
    if (body.min_tickets != null && body.min_tickets !== '') {
      const parsed = typeof body.min_tickets === 'number' 
        ? body.min_tickets 
        : parseInt(String(body.min_tickets), 10)
      if (!isNaN(parsed) && parsed > 0) {
        minTickets = parsed
      }
    } else if (body.minParticipants != null && body.minParticipants !== '') {
      // Fallback to minParticipants if min_tickets not provided
      const parsed = typeof body.minParticipants === 'number' 
        ? body.minParticipants 
        : parseInt(String(body.minParticipants), 10)
      if (!isNaN(parsed) && parsed > 0) {
        minTickets = parsed
      }
    }

    // Parse optional metadata fields
    const rank = body.rank && body.rank.trim() ? body.rank.trim() : null
    const floorPrice = body.floor_price && body.floor_price.trim() ? body.floor_price.trim() : null

    // Build raffle data - only include NFT fields if this is an NFT prize
    const raffleData: Omit<Raffle, 'id' | 'created_at' | 'updated_at'> = {
      slug: slug, // Use the generated unique slug
      title: body.title,
      description: body.description || null,
      image_url: body.image_url || null,
      prize_type: prizeType,
      prize_amount: prizeAmount,
      prize_currency: prizeCurrency,
      // Only include NFT fields if prize_type is 'nft' or if explicitly provided
      nft_mint_address: prizeType === 'nft' ? nftMintAddress : null,
      nft_collection_name: prizeType === 'nft' ? (body.nft_collection_name || null) : null,
      nft_token_id: prizeType === 'nft' ? nftTokenId : null,
      nft_metadata_uri: prizeType === 'nft' ? (body.nft_metadata_uri || null) : null,
      ticket_price: body.ticket_price,
      currency: body.currency || 'SOL',
      max_tickets: body.max_tickets ? parseInt(body.max_tickets) : null,
      min_tickets: minTickets,
      start_time: startTime,
      end_time: body.end_time,
      original_end_time: body.end_time, // Store original end time when raffle is created
      theme_accent: body.theme_accent || 'prime',
      edited_after_entries: false,
      created_by: walletAddress,
      is_active: true,
      winner_wallet: null,
      winner_selected_at: null,
      status: ['draft', 'live', 'ready_to_draw', 'completed'].includes(body.status) ? body.status : 'draft',
      nft_transfer_transaction: null,
      rank: rank,
      floor_price: floorPrice,
    }

    const raffle = await withTimeout(createRaffle(raffleData), SUPABASE_TIMEOUT_MS, 'supabase error')

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
