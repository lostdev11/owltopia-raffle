import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import {
  createRaffle,
  DuplicateActiveNftPrizeError,
  findNonTerminalNftRaffleByPrizeAssetId,
  findNonTerminalPartnerCryptoRaffleByCreator,
  generateUniqueSlug,
  getRaffleCreationCountForCreatorToday,
} from '@/lib/db/raffles'
import { requireSession } from '@/lib/auth-server'
import { isOwlEnabled } from '@/lib/tokens'
import { getSolanaReadConnection } from '@/lib/solana/connection'
import { getNftHolderInWallet } from '@/lib/solana/wallet-tokens'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import type { Raffle, ThemeAccent } from '@/lib/types'
import { THEME_ACCENT_VALUES } from '@/lib/types'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getAdminRole } from '@/lib/db/admins'
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
import { descriptionContainsBlockedLinks } from '@/lib/raffle-description-links'
import {
  canWalletUsePartnerPrizeTokenForCreate,
  getPartnerPrizeListingImageUrl,
  getPartnerPrizeTokenByCurrency,
  isPartnerPrizeCurrency,
  listPartnerPrizeTokens,
} from '@/lib/partner-prize-tokens'
import { humanPartnerPrizeToRawUnits } from '@/lib/partner-prize-amount'
import { normalizePrizeAssetIdForRaffle, normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getPartnerRaffleVisibilityEntitlementForCreatorWallet } from '@/lib/db/partner-community-creators-admin'
import { getMetaplexTokenMetadataNameSymbol } from '@/lib/solana/metaplex-mint-onchain-metadata'
import { onchainMetadataLooksLikeSnsDomain } from '@/lib/raffles/sns-domain-metadata'
import { BAMBOO_TICKET_CURRENCY, canWalletUseBambooTicketCurrency } from '@/lib/raffles/bamboo-ticket-currency'

/** Same as /api/me/dashboard — client sends the adapter’s pubkey so we can reject stale SIWS sessions after wallet switches. */
const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

// POST create path: stay under ~10s of work so Hobby (10s cap) still returns JSON; Pro allows 60s wall clock.
const SUPABASE_TIMEOUT_MS = 7_000

function coerceThemeAccent(raw: unknown): ThemeAccent {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return (THEME_ACCENT_VALUES as readonly string[]).includes(s) ? (s as ThemeAccent) : 'prime'
}

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

export async function handleCreateRafflePost(
  request: NextRequest,
  opts: { snsDomainHubOnly?: boolean } = {}
) {
  const snsDomainHubOnly = opts.snsDomainHubOnly === true
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
        return NextResponse.json({ error: `Missing required field: ${field}` }, { status: 400 })
      }
    }

    const rawWalletIntent =
      (typeof body.wallet_address === 'string' ? body.wallet_address : '').trim() ||
      request.headers.get(CONNECTED_WALLET_HEADER)?.trim() ||
      ''
    if (!rawWalletIntent) {
      return NextResponse.json(
        { error: 'Missing wallet_address. Refresh the page and try again.' },
        { status: 400 }
      )
    }
    const sessionNorm = normalizeSolanaWalletAddress(session.wallet)
    const intentNorm = normalizeSolanaWalletAddress(rawWalletIntent)
    if (!sessionNorm || !intentNorm) {
      return NextResponse.json(
        { error: 'Invalid wallet address. Refresh the page and try again.' },
        { status: 400 }
      )
    }
    if (sessionNorm !== intentNorm) {
      return NextResponse.json(
        {
          error:
            'Your signed-in wallet does not match the wallet connected in your browser. Open Dashboard, sign in again with the wallet you are using, then create the raffle.',
        },
        { status: 401 }
      )
    }

    const walletAddress = sessionNorm

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
      return NextResponse.json({ error: 'end_time must be after start_time' }, { status: 400 })
    }

    // Validate that raffle duration does not exceed 7 days
    const durationMs = endDate.getTime() - startDate.getTime()
    const durationDays = durationMs / (1000 * 60 * 60 * 24)
    if (durationDays > 7) {
      return NextResponse.json({ error: 'Raffle duration cannot exceed 7 days' }, { status: 400 })
    }

    const requestedCurrency =
      typeof body.currency === 'string' && body.currency.trim()
        ? body.currency.trim().toUpperCase()
        : ''
    const adminRole = await getAdminRole(walletAddress)
    const canCreateBambooTicketRaffle =
      adminRole !== null || canWalletUseBambooTicketCurrency(walletAddress)

    // Ticket currency: SOL/USDC for everyone; OWL when configured; Bamboo is supported but permission-gated below.
    const validCurrencies: string[] = ['USDC', 'SOL']
    if (isOwlEnabled()) validCurrencies.push('OWL')
    validCurrencies.push(BAMBOO_TICKET_CURRENCY)
    if (requestedCurrency && !validCurrencies.includes(requestedCurrency)) {
      return NextResponse.json(
        { error: `Currency must be one of: ${validCurrencies.join(', ')}` },
        { status: 400 }
      )
    }

    const partnerCurrencyRaw =
      typeof body.prize_currency === 'string' ? body.prize_currency.trim().toUpperCase() : ''
    const isPartnerCryptoCreate =
      String(body.prize_type || '').toLowerCase() === 'crypto' &&
      !!partnerCurrencyRaw &&
      isPartnerPrizeCurrency(partnerCurrencyRaw)

    if (snsDomainHubOnly && isPartnerCryptoCreate) {
      return NextResponse.json(
        {
          error:
            'SNS domain hub is for .sol name NFTs only. Use the regular Create raffle page for partner token prizes.',
        },
        { status: 400 }
      )
    }

    if (String(body.prize_type || '').toLowerCase() === 'crypto' && !isPartnerCryptoCreate) {
      const supported = listPartnerPrizeTokens()
        .map((t) => t.currencyCode)
        .join(', ')
      return NextResponse.json(
        { error: `Only partner token prizes (${supported}) are supported for crypto prize raffles right now.` },
        { status: 400 }
      )
    }

    if (snsDomainHubOnly) {
      if (String(body.prize_type || 'nft').toLowerCase() !== 'nft') {
        return NextResponse.json(
          { error: 'SNS domain raffles must use an NFT prize (your .sol domain).' },
          { status: 400 }
        )
      }
    } else if (!isPartnerCryptoCreate && body.prize_type && body.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'Only NFT raffles or partner token prize raffles can be created right now.' },
        { status: 400 }
      )
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

    const effectiveTicketCurrency = requestedCurrency || 'SOL'
    if (effectiveTicketCurrency === 'OWL' && adminRole === null) {
      return NextResponse.json(
        {
          error:
            'OWL ticket currency is only available to platform admins. Choose SOL or USDC for public raffles.',
        },
        { status: 403 }
      )
    }
    if (effectiveTicketCurrency === BAMBOO_TICKET_CURRENCY && !canCreateBambooTicketRaffle) {
      return NextResponse.json(
        {
          error:
            'Bamboo ticket currency is only available to the PNDA Partner Pro creator wallet and platform admins.',
        },
        { status: 403 }
      )
    }
    if (partnerCurrencyRaw === 'OWL' && adminRole === null) {
      return NextResponse.json(
        {
          error:
            'OWL partner-token prizes are only available to platform admins. Choose a different partner token.',
        },
        { status: 403 }
      )
    }
    if (
      partnerCurrencyRaw &&
      isPartnerPrizeCurrency(partnerCurrencyRaw) &&
      adminRole === null &&
      !canWalletUsePartnerPrizeTokenForCreate(walletAddress, partnerCurrencyRaw)
    ) {
      return NextResponse.json(
        {
          error:
            'This prize token is reserved for the Pandarianz (PNDA) Partner Pro creator wallet. Choose a different partner token or connect the correct wallet.',
        },
        { status: 403 }
      )
    }

    let discordPartnerTenantId: string | null = null
    let canSetPartnerOnly = false
    try {
      const entitlement = await withTimeout(
        getPartnerRaffleVisibilityEntitlementForCreatorWallet(walletAddress),
        SUPABASE_TIMEOUT_MS,
        'supabase error'
      )
      discordPartnerTenantId = entitlement.discordPartnerTenantId
      canSetPartnerOnly = entitlement.canSetPartnerOnly
    } catch {
      discordPartnerTenantId = null
      canSetPartnerOnly = false
    }

    const requestUnlisted = body.list_on_platform === false || body.listOnPlatform === false
    if (requestUnlisted) {
      if (adminRole === null && !canSetPartnerOnly) {
        return NextResponse.json(
          {
            error:
              'Partner raffle only visibility is available for active Partner Pro / white-label wallets or admins. Leave list_on_platform unset to list the raffle for everyone.',
          },
          { status: 400 }
        )
      }
    }
    const list_on_platform = !requestUnlisted

    let raffleData: Omit<Raffle, 'id' | 'created_at' | 'updated_at'>

    if (isPartnerCryptoCreate) {
      const prizeCurrency = partnerCurrencyRaw
      const rawUnits = humanPartnerPrizeToRawUnits(prizeCurrency, body.prize_amount)
      if (rawUnits == null) {
        return NextResponse.json(
          {
            error:
              'prize_amount must be a positive decimal compatible with the partner token (no scientific notation).',
          },
          { status: 400 }
        )
      }
      const minTicketsParsed =
        typeof body.min_tickets === 'number' ? body.min_tickets : parseInt(String(body.min_tickets ?? ''), 10)
      if (!Number.isFinite(minTicketsParsed) || minTicketsParsed < 1) {
        return NextResponse.json(
          { error: 'min_tickets is required for partner token raffles and must be a positive integer.' },
          { status: 400 }
        )
      }
      const minTickets = minTicketsParsed
      const capCheck = validateNftMinTicketsNotOverCap(minTickets)
      if (!capCheck.ok) {
        return NextResponse.json({ error: capCheck.error }, { status: 400 })
      }
      const maxCheck = validateNftMaxTickets(maxTickets, minTickets)
      if (!maxCheck.ok) {
        return NextResponse.json({ error: maxCheck.error }, { status: 400 })
      }
      const tpParsed = parseNftTicketPrice(body.ticket_price)
      if (!tpParsed.ok) {
        return NextResponse.json({ error: tpParsed.error }, { status: 400 })
      }
      const ticketPriceNum = tpParsed.value
      const fpParsed = parseNftFloorPrice(body.floor_price ?? body.prize_amount)
      if (!fpParsed.ok) {
        return NextResponse.json({ error: fpParsed.error }, { status: 400 })
      }
      const floorPrice = fpParsed.string
      const prizeAmountNum =
        typeof body.prize_amount === 'number' ? body.prize_amount : parseFloat(String(body.prize_amount).trim())
      if (!Number.isFinite(prizeAmountNum) || prizeAmountNum <= 0) {
        return NextResponse.json({ error: 'prize_amount must be a positive number.' }, { status: 400 })
      }

      if (adminRole === null) {
        const existingPartner = await withTimeout(
          findNonTerminalPartnerCryptoRaffleByCreator(walletAddress, prizeCurrency),
          SUPABASE_TIMEOUT_MS,
          'supabase error'
        )
        if (existingPartner) {
          return NextResponse.json(
            {
              error:
                'You already have an active partner-token raffle. Finish or cancel it before starting another with the same prize token.',
              existing_slug: existingPartner.slug,
            },
            { status: 409 }
          )
        }
      }

      const listingImage =
        typeof body.image_url === 'string' && body.image_url.trim()
          ? body.image_url.trim()
          : getPartnerPrizeListingImageUrl(prizeCurrency)

      raffleData = {
        slug,
        title: body.title,
        description: body.description || null,
        image_url: listingImage,
        image_fallback_url:
          typeof body.image_fallback_url === 'string' && body.image_fallback_url.trim()
            ? body.image_fallback_url.trim()
            : null,
        prize_type: 'crypto',
        prize_amount: prizeAmountNum,
        prize_currency: prizeCurrency,
        nft_mint_address: null,
        nft_collection_name: null,
        nft_token_id: null,
        nft_metadata_uri: null,
        ticket_price: ticketPriceNum,
        currency:
          (typeof body.currency === 'string' && body.currency.trim()
            ? body.currency.trim().toUpperCase()
            : null) || 'SOL',
        max_tickets: maxTickets,
        min_tickets: minTickets,
        start_time: startTime,
        end_time: body.end_time,
        original_end_time: body.end_time,
        time_extension_count: 0,
        theme_accent: coerceThemeAccent(body.theme_accent),
        edited_after_entries: false,
        created_by: walletAddress,
        creator_wallet: walletAddress,
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
        rank: body.rank && body.rank.trim() ? body.rank.trim() : null,
        floor_price: floorPrice,
        prize_deposited_at: null,
        prize_deposit_tx: null,
        cancellation_requested_at: null,
        cancelled_at: null,
        cancellation_fee_amount: null,
        cancellation_fee_currency: null,
        cancellation_refund_policy: null,
        cancellation_fee_paid_at: null,
        cancellation_fee_payment_tx: null,
        prize_returned_at: null,
        prize_return_reason: null,
        prize_return_tx: null,
        ticket_payments_to_funds_escrow: true,
        nft_escrow_address_snapshot: getPrizeEscrowPublicKey(),
        funds_escrow_address_snapshot: getFundsEscrowPublicKey(),
        creator_claimed_at: null,
        creator_claim_tx: null,
        creator_funds_claim_locked_at: null,
        prize_standard:
          getPartnerPrizeTokenByCurrency(prizeCurrency)?.tokenProgram === 'token2022' ? 'token2022' : 'spl',
        discord_partner_tenant_id: discordPartnerTenantId,
        list_on_platform,
        sol_domains_hub: false,
      }
    } else {
      const prizeType: 'nft' = 'nft'
      const prizeAmount: number | null = null
      const prizeCurrency: string | null = null

      let nftMintAddress =
        typeof body.nft_mint_address === 'string' && body.nft_mint_address.trim()
          ? body.nft_mint_address.trim()
          : null
      let nftTokenId =
        typeof body.nft_token_id === 'string' && body.nft_token_id.trim() ? body.nft_token_id.trim() : null
      if (nftMintAddress) nftMintAddress = normalizePrizeAssetIdForRaffle(nftMintAddress) ?? nftMintAddress
      if (nftTokenId) nftTokenId = normalizePrizeAssetIdForRaffle(nftTokenId) ?? nftTokenId

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

      if (nftMintAddress) {
        try {
          const mintPk = new PublicKey(nftMintAddress)
          const creatorPk = new PublicKey(walletAddress)
          const holder = await getNftHolderInWallet(getSolanaReadConnection(), mintPk, creatorPk, 'confirmed')
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

      if (snsDomainHubOnly) {
        if (!nftMintAddress) {
          return NextResponse.json(
            {
              error:
                'SNS domain raffles require nft_mint_address. Pick the domain from your wallet on the SNS create page.',
            },
            { status: 400 }
          )
        }
        try {
          const meta = await getMetaplexTokenMetadataNameSymbol(
            getSolanaReadConnection(),
            new PublicKey(nftMintAddress)
          )
          if (
            !meta ||
            !onchainMetadataLooksLikeSnsDomain(
              meta.name,
              meta.symbol,
              typeof body.nft_collection_name === 'string' ? body.nft_collection_name.trim() || null : null
            )
          ) {
            return NextResponse.json(
              {
                error:
                  'This mint is not recognized as a Solana Name Service (.sol) domain on-chain. Use the regular Create raffle page for other NFTs.',
              },
              { status: 400 }
            )
          }
        } catch {
          return NextResponse.json(
            { error: 'Could not verify this mint as a .sol domain NFT. Check the address and try again.' },
            { status: 400 }
          )
        }
      }

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

      if (prizeAssetId) {
        const existingForPrize = await withTimeout(
          findNonTerminalNftRaffleByPrizeAssetId(prizeAssetId),
          SUPABASE_TIMEOUT_MS,
          'supabase error'
        )
        if (existingForPrize) {
          return NextResponse.json(
            {
              error:
                'This NFT already has an active raffle listing. Open that listing or wait until it completes or is cancelled.',
              existing_slug: existingForPrize.slug,
            },
            { status: 409 }
          )
        }
      }

      const rank = body.rank && body.rank.trim() ? body.rank.trim() : null
      const floorPrice = fpParsed.string

      raffleData = {
        slug,
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
        nft_mint_address: prizeType === 'nft' ? nftMintAddress : null,
        nft_collection_name: prizeType === 'nft' ? (body.nft_collection_name || null) : null,
        nft_token_id: prizeType === 'nft' ? nftTokenId : null,
        nft_metadata_uri: prizeType === 'nft' ? (body.nft_metadata_uri || null) : null,
        ticket_price: ticketPriceNum,
        currency:
          (typeof body.currency === 'string' && body.currency.trim()
            ? body.currency.trim().toUpperCase()
            : null) || 'SOL',
        max_tickets: maxTickets,
        min_tickets: minTickets,
        start_time: startTime,
        end_time: body.end_time,
        original_end_time: body.end_time,
        time_extension_count: 0,
        theme_accent: coerceThemeAccent(body.theme_accent),
        edited_after_entries: false,
        created_by: walletAddress,
        creator_wallet: walletAddress,
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
        rank,
        floor_price: floorPrice,
        prize_deposited_at: null,
        prize_deposit_tx: null,
        cancellation_requested_at: null,
        cancelled_at: null,
        cancellation_fee_amount: null,
        cancellation_fee_currency: null,
        cancellation_refund_policy: null,
        cancellation_fee_paid_at: null,
        cancellation_fee_payment_tx: null,
        prize_returned_at: null,
        prize_return_reason: null,
        prize_return_tx: null,
        ticket_payments_to_funds_escrow: true,
        nft_escrow_address_snapshot: getPrizeEscrowPublicKey(),
        funds_escrow_address_snapshot: getFundsEscrowPublicKey(),
        creator_claimed_at: null,
        creator_claim_tx: null,
        creator_funds_claim_locked_at: null,
        discord_partner_tenant_id: discordPartnerTenantId,
        list_on_platform,
        sol_domains_hub: snsDomainHubOnly,
      }
    }

    if (adminRole === null) {
      const feeTier = await getCreatorFeeTier(walletAddress, { skipCache: true })
      // Owltopia Owl NFT holders + partner-community creators: 3 raffles/day (partners use allowlist only; no holder DAS).
      const isHolderForLimit =
        isOwlEnabled() && (feeTier.reason === 'holder' || feeTier.reason === 'partner_community')
      const maxRafflesPerDay = isHolderForLimit ? 3 : 1
      const createdToday = await withTimeout(
        getRaffleCreationCountForCreatorToday(walletAddress),
        SUPABASE_TIMEOUT_MS,
        'supabase error'
      )
      if (createdToday >= maxRafflesPerDay) {
        const message = isHolderForLimit
          ? 'Owltopia partners and Owl NFT holders can host up to 3 raffles per day. You’ve reached today’s limit. Try again tomorrow (UTC).'
          : 'You can host 1 raffle per day. Owltopia partners and Owl NFT holders can host up to 3. Try again tomorrow (UTC).'
        return NextResponse.json({ error: message }, { status: 429 })
      }
    }

    const descriptionRaw = typeof body.description === 'string' ? body.description : ''
    if (adminRole === null && descriptionContainsBlockedLinks(descriptionRaw)) {
      return NextResponse.json(
        {
          error:
            'Descriptions cannot include links or web addresses. Remove URLs, domains (e.g. example.com), IP addresses, Discord/Telegram invites, and markdown links.',
        },
        { status: 400 }
      )
    }

    try {
      const raffle = await withTimeout(createRaffle(raffleData), SUPABASE_TIMEOUT_MS, 'supabase error')

      await notifyRaffleCreated(raffle)

      return NextResponse.json(raffle, { status: 201 })
    } catch (createErr) {
      if (createErr instanceof DuplicateActiveNftPrizeError) {
        const mintRaw =
          typeof body.nft_mint_address === 'string'
            ? body.nft_mint_address.trim()
            : typeof body.nft_token_id === 'string'
              ? body.nft_token_id.trim()
              : ''
        const normalizedMint = mintRaw ? normalizePrizeAssetIdForRaffle(mintRaw) ?? mintRaw : ''
        const existing = normalizedMint
          ? await withTimeout(
              findNonTerminalNftRaffleByPrizeAssetId(normalizedMint),
              SUPABASE_TIMEOUT_MS,
              'supabase error'
            ).catch(() => null)
          : null
        return NextResponse.json(
          {
            error:
              'This NFT already has an active raffle listing. Open that listing or wait until it completes or is cancelled.',
            existing_slug: existing?.slug,
          },
          { status: 409 }
        )
      }
      throw createErr
    }
  } catch (error) {
    console.error('Error creating raffle:', error)
    const err = error as Error & { step?: 'timeout' | 'supabase error' }
    const step = err.step ?? 'supabase error'
    const raw = err instanceof Error ? err.message : String(error)
    // Legacy DB migration 050 fixed min_tickets at 50 for NFT rows; 051/054 drop that. Without 054, creates fail CHECK.
    if (
      raw.includes('raffles_nft_min_tickets_fixed') ||
      raw.includes('raffles_nft_max_tickets_minimum')
    ) {
      return NextResponse.json(
        {
          error:
            'New raffles cannot be saved until the database is updated (legacy NFT ticket rules). Please contact the site administrator.',
          step,
        },
        { status: 503 }
      )
    }
    // UI allows accents added after migration 037; without 093 (extend_theme_accent_more) INSERT fails this CHECK.
    if (/raffles_theme_accent_check/i.test(raw) || /theme_accent.*check constraint/i.test(raw)) {
      return NextResponse.json(
        {
          error:
            'This accent color needs a quick database update on the server. Try Prime, Midnight, or Dawn for now, or ask an admin to apply migration 093_extend_theme_accent_more.sql.',
          step,
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: safeErrorMessage(err), step }, { status: 502 })
  }
}
