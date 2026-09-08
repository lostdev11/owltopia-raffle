/**
 * OwlSwap offers + assets + ledger — service-role CRUD via getSupabaseAdmin.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type {
  OwlSwapAssetKind,
  OwlSwapAssetSide,
  OwlSwapOfferStatus,
} from '@/lib/owl-swap/types'

export type OwlSwapOfferRow = {
  id: string
  short_code: string
  maker_wallet: string
  taker_wallet: string | null
  status: OwlSwapOfferStatus
  maker_sol_lamports: number
  taker_sol_lamports: number
  owl_fee_lamports: number | null
  fee_discount_bps: number
  maker_deposit_sig: string | null
  taker_deposit_sig: string | null
  settle_sig: string | null
  expires_at: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type OwlSwapOfferAssetRow = {
  id: string
  offer_id: string
  side: OwlSwapAssetSide
  asset_kind: OwlSwapAssetKind
  mint: string
  amount: number
  name: string | null
  image_url: string | null
  collection: string | null
  verified: boolean
  created_at: string
}

export type OwlSwapLedgerRow = {
  id: string
  offer_id: string | null
  short_code: string | null
  maker_wallet: string
  taker_wallet: string
  settle_sig: string
  owl_fee_lamports: number | null
  fee_discount_bps: number
  maker_mint_count: number
  taker_mint_count: number
  created_at: string
}

export type InsertOwlSwapOfferInput = {
  shortCode: string
  makerWallet: string
  makerSolLamports?: number
  takerSolLamports?: number
  expiresAt: string
  status?: OwlSwapOfferStatus
}

export type InsertOwlSwapAssetInput = {
  offerId: string
  side: OwlSwapAssetSide
  mint: string
  amount?: number
  name?: string | null
  imageUrl?: string | null
  collection?: string | null
  verified?: boolean
  assetKind?: OwlSwapAssetKind
}

function num(v: unknown, fallback = 0): number {
  if (v == null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function normalizeOffer(raw: Record<string, unknown>): OwlSwapOfferRow {
  return {
    id: String(raw.id),
    short_code: String(raw.short_code),
    maker_wallet: String(raw.maker_wallet),
    taker_wallet: raw.taker_wallet == null ? null : String(raw.taker_wallet),
    status: raw.status as OwlSwapOfferStatus,
    maker_sol_lamports: num(raw.maker_sol_lamports),
    taker_sol_lamports: num(raw.taker_sol_lamports),
    owl_fee_lamports: raw.owl_fee_lamports == null ? null : num(raw.owl_fee_lamports),
    fee_discount_bps: num(raw.fee_discount_bps),
    maker_deposit_sig: raw.maker_deposit_sig == null ? null : String(raw.maker_deposit_sig),
    taker_deposit_sig: raw.taker_deposit_sig == null ? null : String(raw.taker_deposit_sig),
    settle_sig: raw.settle_sig == null ? null : String(raw.settle_sig),
    expires_at: String(raw.expires_at),
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
    completed_at: raw.completed_at == null ? null : String(raw.completed_at),
  }
}

function normalizeAsset(raw: Record<string, unknown>): OwlSwapOfferAssetRow {
  return {
    id: String(raw.id),
    offer_id: String(raw.offer_id),
    side: raw.side as OwlSwapAssetSide,
    asset_kind: (raw.asset_kind as OwlSwapAssetKind) ?? 'spl_nft',
    mint: String(raw.mint),
    amount: num(raw.amount, 1),
    name: raw.name == null ? null : String(raw.name),
    image_url: raw.image_url == null ? null : String(raw.image_url),
    collection: raw.collection == null ? null : String(raw.collection),
    verified: raw.verified === true,
    created_at: String(raw.created_at),
  }
}

function normalizeLedger(raw: Record<string, unknown>): OwlSwapLedgerRow {
  return {
    id: String(raw.id),
    offer_id: raw.offer_id == null ? null : String(raw.offer_id),
    short_code: raw.short_code == null ? null : String(raw.short_code),
    maker_wallet: String(raw.maker_wallet),
    taker_wallet: String(raw.taker_wallet),
    settle_sig: String(raw.settle_sig),
    owl_fee_lamports: raw.owl_fee_lamports == null ? null : num(raw.owl_fee_lamports),
    fee_discount_bps: num(raw.fee_discount_bps),
    maker_mint_count: num(raw.maker_mint_count),
    taker_mint_count: num(raw.taker_mint_count),
    created_at: String(raw.created_at),
  }
}

export async function insertOwlSwapOffer(
  input: InsertOwlSwapOfferInput
): Promise<{ ok: true; row: OwlSwapOfferRow } | { ok: false; error: string }> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_swap_offers')
    .insert({
      short_code: input.shortCode,
      maker_wallet: input.makerWallet,
      maker_sol_lamports: input.makerSolLamports ?? 0,
      taker_sol_lamports: input.takerSolLamports ?? 0,
      expires_at: input.expiresAt,
      status: input.status ?? 'draft',
    })
    .select('*')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, row: normalizeOffer(data as Record<string, unknown>) }
}

export async function insertOwlSwapOfferAssets(
  assets: InsertOwlSwapAssetInput[]
): Promise<{ ok: true; rows: OwlSwapOfferAssetRow[] } | { ok: false; error: string }> {
  if (assets.length === 0) return { ok: true, rows: [] }
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_swap_offer_assets')
    .insert(
      assets.map((a) => ({
        offer_id: a.offerId,
        side: a.side,
        mint: a.mint,
        amount: a.amount ?? 1,
        name: a.name ?? null,
        image_url: a.imageUrl ?? null,
        collection: a.collection ?? null,
        verified: a.verified ?? false,
        asset_kind: a.assetKind ?? 'spl_nft',
      }))
    )
    .select('*')

  if (error) return { ok: false, error: error.message }
  return {
    ok: true,
    rows: (data ?? []).map((r) => normalizeAsset(r as Record<string, unknown>)),
  }
}

export async function getOwlSwapOfferById(id: string): Promise<OwlSwapOfferRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_swap_offers').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? normalizeOffer(data as Record<string, unknown>) : null
}

export async function getOwlSwapOfferByShortCode(
  code: string
): Promise<OwlSwapOfferRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_swap_offers')
    .select('*')
    .eq('short_code', code.trim())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? normalizeOffer(data as Record<string, unknown>) : null
}

export async function listOwlSwapOfferAssets(
  offerId: string
): Promise<OwlSwapOfferAssetRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_swap_offer_assets')
    .select('*')
    .eq('offer_id', offerId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => normalizeAsset(r as Record<string, unknown>))
}

export async function listOwlSwapOffersForMaker(params: {
  makerWallet: string
  limit?: number
}): Promise<OwlSwapOfferRow[]> {
  const db = getSupabaseAdmin()
  const limit = Math.min(100, Math.max(1, params.limit ?? 40))
  const { data, error } = await db
    .from('owl_swap_offers')
    .select('*')
    .eq('maker_wallet', params.makerWallet)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => normalizeOffer(r as Record<string, unknown>))
}

export async function countOpenOwlSwapOffersForMaker(makerWallet: string): Promise<number> {
  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('owl_swap_offers')
    .select('id', { count: 'exact', head: true })
    .eq('maker_wallet', makerWallet)
    .in('status', ['draft', 'open'])
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function updateOwlSwapOffer(
  id: string,
  patch: Partial<{
    status: OwlSwapOfferStatus
    taker_wallet: string | null
    taker_sol_lamports: number
    owl_fee_lamports: number | null
    fee_discount_bps: number
    maker_deposit_sig: string | null
    taker_deposit_sig: string | null
    settle_sig: string | null
    completed_at: string | null
    updated_at: string
  }>
): Promise<{ ok: true; row: OwlSwapOfferRow } | { ok: false; error: string }> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_swap_offers')
    .update({
      ...patch,
      updated_at: patch.updated_at ?? new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, row: normalizeOffer(data as Record<string, unknown>) }
}

export async function deleteOwlSwapOfferAssetsForSide(
  offerId: string,
  side: OwlSwapAssetSide
): Promise<void> {
  const db = getSupabaseAdmin()
  const { error } = await db
    .from('owl_swap_offer_assets')
    .delete()
    .eq('offer_id', offerId)
    .eq('side', side)
  if (error) throw new Error(error.message)
}

export async function insertOwlSwapLedger(input: {
  offerId: string
  shortCode: string
  makerWallet: string
  takerWallet: string
  settleSig: string
  owlFeeLamports: number | null
  feeDiscountBps: number
  makerMintCount: number
  takerMintCount: number
}): Promise<{ ok: true; row: OwlSwapLedgerRow } | { ok: false; error: string; duplicate?: boolean }> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_swap_ledger')
    .insert({
      offer_id: input.offerId,
      short_code: input.shortCode,
      maker_wallet: input.makerWallet,
      taker_wallet: input.takerWallet,
      settle_sig: input.settleSig,
      owl_fee_lamports: input.owlFeeLamports,
      fee_discount_bps: input.feeDiscountBps,
      maker_mint_count: input.makerMintCount,
      taker_mint_count: input.takerMintCount,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'Already recorded.', duplicate: true }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, row: normalizeLedger(data as Record<string, unknown>) }
}

export async function listOwlSwapLedgerForWallet(params: {
  wallet: string
  limit?: number
}): Promise<OwlSwapLedgerRow[]> {
  const db = getSupabaseAdmin()
  const limit = Math.min(100, Math.max(1, params.limit ?? 40))
  const { data, error } = await db
    .from('owl_swap_ledger')
    .select('*')
    .or(`maker_wallet.eq.${params.wallet},taker_wallet.eq.${params.wallet}`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => normalizeLedger(r as Record<string, unknown>))
}

export type OwlSwapOfferWithAssets = OwlSwapOfferRow & {
  assets: OwlSwapOfferAssetRow[]
}

export async function getOwlSwapOfferWithAssetsByCode(
  code: string
): Promise<OwlSwapOfferWithAssets | null> {
  const offer = await getOwlSwapOfferByShortCode(code)
  if (!offer) return null
  const assets = await listOwlSwapOfferAssets(offer.id)
  return { ...offer, assets }
}

export async function getOwlSwapOfferWithAssetsById(
  id: string
): Promise<OwlSwapOfferWithAssets | null> {
  const offer = await getOwlSwapOfferById(id)
  if (!offer) return null
  const assets = await listOwlSwapOfferAssets(offer.id)
  return { ...offer, assets }
}
