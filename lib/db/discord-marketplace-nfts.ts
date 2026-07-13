import { randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type NftListingCurrency = 'SOL' | 'OWL'
export type NftListingStatus =
  | 'pending_deposit'
  | 'available'
  | 'sold'
  | 'fulfillment_failed'
  | 'removed'

export type DiscordMarketplaceNftListing = {
  id: string
  discord_guild_id: string
  listing_slug: string
  nft_mint: string
  display_name: string | null
  price_amount: number
  currency: NftListingCurrency
  status: NftListingStatus
  deposit_tx_signature: string | null
  listed_by_discord_user_id: string | null
  buyer_discord_user_id: string | null
  buyer_wallet: string | null
  payment_tx_signature: string | null
  fulfillment_tx_signature: string | null
  fulfillment_error: string | null
  created_at: string
  sold_at: string | null
}

export type NftPurchaseIntent = {
  id: string
  reference_code: string
  listing_id: string
  discord_user_id: string
  buyer_wallet: string
  price_amount: number
  currency: NftListingCurrency
  memo: string
  status: 'pending' | 'confirmed' | 'expired' | 'superseded'
  confirmed_signature: string | null
  created_at: string
  expires_at: string
}

function mapListing(row: Record<string, unknown>): DiscordMarketplaceNftListing {
  return {
    id: String(row.id),
    discord_guild_id: String(row.discord_guild_id),
    listing_slug: String(row.listing_slug),
    nft_mint: String(row.nft_mint),
    display_name: row.display_name != null ? String(row.display_name) : null,
    price_amount: Number(row.price_amount),
    currency: row.currency as NftListingCurrency,
    status: row.status as NftListingStatus,
    deposit_tx_signature: row.deposit_tx_signature != null ? String(row.deposit_tx_signature) : null,
    listed_by_discord_user_id:
      row.listed_by_discord_user_id != null ? String(row.listed_by_discord_user_id) : null,
    buyer_discord_user_id: row.buyer_discord_user_id != null ? String(row.buyer_discord_user_id) : null,
    buyer_wallet: row.buyer_wallet != null ? String(row.buyer_wallet) : null,
    payment_tx_signature: row.payment_tx_signature != null ? String(row.payment_tx_signature) : null,
    fulfillment_tx_signature:
      row.fulfillment_tx_signature != null ? String(row.fulfillment_tx_signature) : null,
    fulfillment_error: row.fulfillment_error != null ? String(row.fulfillment_error) : null,
    created_at: String(row.created_at),
    sold_at: row.sold_at != null ? String(row.sold_at) : null,
  }
}

function mapIntent(row: Record<string, unknown>): NftPurchaseIntent {
  return {
    id: String(row.id),
    reference_code: String(row.reference_code),
    listing_id: String(row.listing_id),
    discord_user_id: String(row.discord_user_id),
    buyer_wallet: String(row.buyer_wallet),
    price_amount: Number(row.price_amount),
    currency: row.currency as NftListingCurrency,
    memo: String(row.memo),
    status: row.status as NftPurchaseIntent['status'],
    confirmed_signature: row.confirmed_signature != null ? String(row.confirmed_signature) : null,
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
  }
}

export function slugifyNftListingSlug(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return base || 'nft'
}

export function defaultNftListingSlugFromMint(mint: string): string {
  const m = mint.trim()
  if (m.length <= 12) return slugifyNftListingSlug(m)
  return `nft-${m.slice(0, 4)}${m.slice(-4)}`.toLowerCase()
}

export async function createNftListing(params: {
  discord_guild_id: string
  listing_slug: string
  nft_mint: string
  display_name?: string | null
  price_amount: number
  currency: NftListingCurrency
  listed_by_discord_user_id?: string | null
}): Promise<DiscordMarketplaceNftListing | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_listings')
    .insert({
      discord_guild_id: params.discord_guild_id.trim(),
      listing_slug: params.listing_slug.trim().toLowerCase(),
      nft_mint: params.nft_mint.trim(),
      display_name: params.display_name?.trim() || null,
      price_amount: params.price_amount,
      currency: params.currency,
      status: 'pending_deposit',
      listed_by_discord_user_id: params.listed_by_discord_user_id?.trim() || null,
    })
    .select()
    .single()

  if (error) {
    console.error('createNftListing:', error.message)
    return null
  }
  return mapListing(data as Record<string, unknown>)
}

export async function getNftListingBySlug(
  guildId: string,
  slug: string
): Promise<DiscordMarketplaceNftListing | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_listings')
    .select('*')
    .eq('discord_guild_id', guildId.trim())
    .eq('listing_slug', slug.trim().toLowerCase())
    .maybeSingle()

  if (error) {
    console.error('getNftListingBySlug:', error.message)
    return null
  }
  return data ? mapListing(data as Record<string, unknown>) : null
}

export async function getNftListingById(listingId: string): Promise<DiscordMarketplaceNftListing | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_listings')
    .select('*')
    .eq('id', listingId.trim())
    .maybeSingle()

  if (error) {
    console.error('getNftListingById:', error.message)
    return null
  }
  return data ? mapListing(data as Record<string, unknown>) : null
}

export async function listAvailableNftListings(
  guildId: string
): Promise<DiscordMarketplaceNftListing[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_listings')
    .select('*')
    .eq('discord_guild_id', guildId.trim())
    .eq('status', 'available')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listAvailableNftListings:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapListing(r as Record<string, unknown>))
}

export async function listAllNftListings(guildId: string): Promise<DiscordMarketplaceNftListing[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_listings')
    .select('*')
    .eq('discord_guild_id', guildId.trim())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listAllNftListings:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapListing(r as Record<string, unknown>))
}

export async function markNftListingAvailable(
  listingId: string,
  depositTxSignature: string
): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_listings')
    .update({
      status: 'available',
      deposit_tx_signature: depositTxSignature.trim(),
    })
    .eq('id', listingId.trim())
    .eq('status', 'pending_deposit')

  if (error) {
    console.error('markNftListingAvailable:', error.message)
    return false
  }
  return true
}

export async function removeNftListing(listingId: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_listings')
    .update({ status: 'removed' })
    .eq('id', listingId.trim())
    .in('status', ['pending_deposit', 'available'])

  if (error) {
    console.error('removeNftListing:', error.message)
    return false
  }
  return true
}

export async function isNftPaymentSignatureUsed(signature: string): Promise<boolean> {
  const sig = signature.trim()
  if (!sig) return false
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_listings')
    .select('id')
    .eq('payment_tx_signature', sig)
    .maybeSingle()

  if (error) {
    console.error('isNftPaymentSignatureUsed:', error.message)
    return true
  }
  return !!data?.id
}

function generateReferenceCode(): string {
  return randomBytes(6).toString('hex').toUpperCase()
}

export async function createNftPurchaseIntent(params: {
  listing_id: string
  discord_user_id: string
  buyer_wallet: string
  price_amount: number
  currency: NftListingCurrency
  ttlHours?: number
}): Promise<NftPurchaseIntent | null> {
  const reference_code = generateReferenceCode()
  const memo = `OWLSHOP:${reference_code}`
  const ttl = params.ttlHours ?? 2
  const expires_at = new Date(Date.now() + ttl * 60 * 60 * 1000).toISOString()

  await getSupabaseAdmin()
    .from('discord_marketplace_nft_purchase_intents')
    .update({ status: 'superseded' })
    .eq('listing_id', params.listing_id.trim())
    .eq('discord_user_id', params.discord_user_id.trim())
    .eq('status', 'pending')

  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_purchase_intents')
    .insert({
      reference_code,
      listing_id: params.listing_id.trim(),
      discord_user_id: params.discord_user_id.trim(),
      buyer_wallet: params.buyer_wallet.trim(),
      price_amount: params.price_amount,
      currency: params.currency,
      memo,
      status: 'pending',
      expires_at,
    })
    .select()
    .single()

  if (error) {
    console.error('createNftPurchaseIntent:', error.message)
    return null
  }
  return mapIntent(data as Record<string, unknown>)
}

export async function findNftIntentByMemo(memo: string): Promise<NftPurchaseIntent | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_purchase_intents')
    .select('*')
    .eq('memo', memo.trim())
    .eq('status', 'pending')
    .maybeSingle()

  if (error) {
    console.error('findNftIntentByMemo:', error.message)
    return null
  }
  return data ? mapIntent(data as Record<string, unknown>) : null
}

export async function markNftIntentConfirmed(intentId: string, signature: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_nft_purchase_intents')
    .update({
      status: 'confirmed',
      confirmed_signature: signature.trim(),
    })
    .eq('id', intentId.trim())
    .eq('status', 'pending')

  if (error) {
    console.error('markNftIntentConfirmed:', error.message)
    return false
  }
  return true
}

export type CompleteNftSaleResult =
  | {
      ok: true
      listing_id: string
      nft_mint: string
      display_name: string | null
      currency: NftListingCurrency
      price_amount: number
    }
  | { ok: false; code: 'listing_not_found' | 'listing_not_available' | 'db_error'; message: string }

export async function completeNftSale(params: {
  listing_id: string
  buyer_discord_user_id: string
  buyer_wallet: string
  payment_tx_signature: string
}): Promise<CompleteNftSaleResult> {
  const { data, error } = await getSupabaseAdmin().rpc('discord_marketplace_complete_nft_sale', {
    p_listing_id: params.listing_id.trim(),
    p_buyer_discord_user_id: params.buyer_discord_user_id.trim(),
    p_buyer_wallet: params.buyer_wallet.trim(),
    p_payment_tx_signature: params.payment_tx_signature.trim(),
  })

  if (error) {
    const msg = error.message ?? 'db_error'
    if (msg.includes('listing_not_found')) {
      return { ok: false, code: 'listing_not_found', message: 'Listing not found.' }
    }
    if (msg.includes('listing_not_available')) {
      return { ok: false, code: 'listing_not_available', message: 'This NFT was already sold.' }
    }
    console.error('completeNftSale:', msg)
    return { ok: false, code: 'db_error', message: msg }
  }

  const row = data as Record<string, unknown>
  return {
    ok: true,
    listing_id: String(row.listing_id),
    nft_mint: String(row.nft_mint),
    display_name: row.display_name != null ? String(row.display_name) : null,
    currency: row.currency as NftListingCurrency,
    price_amount: Number(row.price_amount),
  }
}

export async function markNftListingFulfilled(
  listingId: string,
  fulfillmentTxSignature: string
): Promise<boolean> {
  const { error } = await getSupabaseAdmin().rpc('discord_marketplace_mark_nft_fulfillment', {
    p_listing_id: listingId.trim(),
    p_fulfillment_tx_signature: fulfillmentTxSignature.trim(),
    p_failed: false,
    p_error: null,
  })
  if (error) {
    console.error('markNftListingFulfilled:', error.message)
    return false
  }
  return true
}

export async function markNftListingFulfillmentFailed(
  listingId: string,
  errorMessage: string
): Promise<boolean> {
  const { error } = await getSupabaseAdmin().rpc('discord_marketplace_mark_nft_fulfillment', {
    p_listing_id: listingId.trim(),
    p_fulfillment_tx_signature: '',
    p_failed: true,
    p_error: errorMessage.slice(0, 500),
  })
  if (error) {
    console.error('markNftListingFulfillmentFailed:', error.message)
    return false
  }
  return true
}
