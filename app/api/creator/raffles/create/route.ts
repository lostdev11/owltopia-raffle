import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { verifyWalletSignature, generateSignMessage } from '@/lib/wallet-verification'
import { isOwltopiaHolder } from '@/lib/nft-ownership'
import { generateUniqueSlug } from '@/lib/db/raffles'
import type { Raffle } from '@/lib/types'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * POST /api/creator/raffles/create
 * Create a raffle (holders only, with signature verification)
 * Requires:
 * - Wallet signature verification
 * - Owltopia NFT holder status
 * - 1 USDC creation fee (logic only, no escrow)
 */
export async function POST(request: NextRequest) {
  try {
    // Check feature flag
    if (process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'Marketplace feature is not enabled' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      walletAddress,
      signature,
      message,
      timestamp,
      // Raffle data
      title,
      description,
      image_url,
      ticket_price,
      currency,
      max_tickets,
      min_tickets,
      start_time,
      end_time,
      theme_accent,
      prize_type,
      prize_amount,
      prize_currency,
      nft_mint_address,
      nft_collection_name,
      nft_token_id,
      nft_metadata_uri,
      creator_payout_wallet,
    } = body

    // Validate required fields
    if (!walletAddress || !signature || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: walletAddress, signature, message' },
        { status: 400 }
      )
    }

    // Verify wallet signature
    const isValidSignature = await verifyWalletSignature(message, signature, walletAddress)
    if (!isValidSignature) {
      return NextResponse.json(
        { error: 'Invalid wallet signature' },
        { status: 401 }
      )
    }

    // Verify message contains expected content
    const expectedMessage = generateSignMessage(walletAddress, 'create a raffle', timestamp)
    if (message !== expectedMessage && !message.includes('create a raffle')) {
      return NextResponse.json(
        { error: 'Invalid message content' },
        { status: 401 }
      )
    }

    // Check if wallet is an Owltopia holder
    const isHolder = await isOwltopiaHolder(walletAddress)
    if (!isHolder) {
      return NextResponse.json(
        { error: 'Only Owltopia NFT holders can create raffles' },
        { status: 403 }
      )
    }

    // Validate required raffle fields
    const requiredFields = ['title', 'ticket_price', 'end_time']
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        )
      }
    }

    // Generate slug from title if not provided
    let slug = body.slug
    if (!slug) {
      slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
    }

    // Ensure slug is unique
    slug = await generateUniqueSlug(slug)

    // Default start_time to current time if not provided
    const startTime = start_time || new Date().toISOString()

    // Validate date strings
    const startDate = new Date(startTime)
    const endDate = new Date(end_time)

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

    // Validate currency
    const validCurrencies = ['USDC', 'SOL']
    if (currency && !validCurrencies.includes(currency)) {
      return NextResponse.json(
        { error: 'Currency must be either USDC or SOL' },
        { status: 400 }
      )
    }

    // Determine prize_type
    let finalPrizeType: 'crypto' | 'nft' = prize_type || 'crypto'
    if (!prize_type && (nft_mint_address || nft_token_id)) {
      finalPrizeType = 'nft'
    }

    // Handle prize data based on type
    let finalPrizeAmount: number | null = null
    let finalPrizeCurrency: string | null = null
    let finalNftMintAddress: string | null = null
    let finalNftTokenId: string | null = null

    if (finalPrizeType === 'crypto') {
      finalPrizeAmount = prize_amount !== undefined ? parseFloat(String(prize_amount)) : 0
      finalPrizeCurrency = prize_currency || currency || 'SOL'
    } else {
      finalNftMintAddress = nft_mint_address || null
      finalNftTokenId = nft_token_id || null

      if (!finalNftMintAddress && !finalNftTokenId) {
        return NextResponse.json(
          { error: 'NFT prizes require either nft_mint_address or nft_token_id' },
          { status: 400 }
        )
      }
    }

    // Parse min_tickets safely
    let minTickets: number | null = null
    if (min_tickets != null && min_tickets !== '') {
      const parsed = typeof min_tickets === 'number' 
        ? min_tickets 
        : parseInt(String(min_tickets), 10)
      if (!isNaN(parsed) && parsed > 0) {
        minTickets = parsed
      }
    }

    // Enforce 1 USDC creation fee (logic only, no escrow)
    // This is tracked but not actually collected yet
    const creationFeeUsdc = 1

    // Build raffle data
    const raffleData: any = {
      slug,
      title,
      description: description || null,
      image_url: image_url || null,
      prize_type: finalPrizeType,
      prize_amount: finalPrizeAmount,
      prize_currency: finalPrizeCurrency,
      ticket_price: parseFloat(String(ticket_price)),
      currency: currency || 'SOL',
      max_tickets: max_tickets ? parseInt(String(max_tickets)) : null,
      min_tickets: minTickets,
      start_time: startTime,
      end_time,
      original_end_time: end_time,
      theme_accent: theme_accent || 'prime',
      edited_after_entries: false,
      created_by: walletAddress,
      is_active: true,
      winner_wallet: null,
      winner_selected_at: null,
      status: null,
      nft_transfer_transaction: null,
      created_by_wallet: walletAddress,
      creator_payout_wallet: creator_payout_wallet || walletAddress,
      platform_fee_bps: 500, // 5%
      creator_share_bps: 9500, // 95%
      creation_fee_usdc: creationFeeUsdc,
      gross_sales_usdc: 0,
      platform_earnings_usdc: 0,
      creator_earnings_usdc: 0,
    }

    // Only include NFT fields if prize_type is 'nft'
    if (finalPrizeType === 'nft') {
      raffleData.nft_mint_address = finalNftMintAddress
      raffleData.nft_collection_name = nft_collection_name || null
      raffleData.nft_token_id = finalNftTokenId
      raffleData.nft_metadata_uri = nft_metadata_uri || null
    }

    // Insert raffle using service role client (bypasses RLS)
    const { data, error } = await supabaseServer
      .from('raffles')
      .insert(raffleData)
      .select()
      .single()

    if (error) {
      console.error('Error creating raffle:', error)
      
      // Handle duplicate slug error
      if (error.message?.includes('raffles_slug_key') || 
          error.message?.includes('duplicate key') ||
          error.message?.includes('unique constraint')) {
        return NextResponse.json(
          { error: `A raffle with the slug "${slug}" already exists. Please use a different title.` },
          { status: 400 }
        )
      }
      
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json(data as Raffle, { status: 201 })
  } catch (error) {
    console.error('Error creating creator raffle:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
