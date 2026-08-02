import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type OwlSendLedgerMode = 'nft_one' | 'nft_scatter' | 'token_one' | 'token_scatter'
export type OwlSendLedgerAssetKind = 'nft' | 'token'

export type OwlSendLedgerLine = {
  recipient: string
  mint?: string | null
  name?: string | null
  amount_raw?: string | null
  decimals?: number | null
  symbol?: string | null
}

export type OwlSendLedgerRow = {
  id: string
  from_wallet: string
  mode: OwlSendLedgerMode
  asset_kind: OwlSendLedgerAssetKind
  tx_signature: string
  recipient_count: number
  asset_count: number
  fee_lamports: number | null
  batch_index: number | null
  lines: OwlSendLedgerLine[]
  created_at: string
}

export type InsertOwlSendLedgerInput = {
  fromWallet: string
  mode: OwlSendLedgerMode
  assetKind: OwlSendLedgerAssetKind
  txSignature: string
  recipientCount: number
  assetCount: number
  feeLamports?: number | null
  batchIndex?: number | null
  lines: OwlSendLedgerLine[]
}

export async function insertOwlSendLedgerRow(
  input: InsertOwlSendLedgerInput
): Promise<{ ok: true; row: OwlSendLedgerRow } | { ok: false; error: string; duplicate?: boolean }> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_send_ledger')
    .insert({
      from_wallet: input.fromWallet,
      mode: input.mode,
      asset_kind: input.assetKind,
      tx_signature: input.txSignature,
      recipient_count: input.recipientCount,
      asset_count: input.assetCount,
      fee_lamports: input.feeLamports ?? null,
      batch_index: input.batchIndex ?? null,
      lines: input.lines,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'Already recorded.', duplicate: true }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, row: normalizeRow(data) }
}

export async function getOwlSendLedgerByTxSignature(
  txSignature: string
): Promise<OwlSendLedgerRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_send_ledger')
    .select('*')
    .eq('tx_signature', txSignature)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? normalizeRow(data) : null
}

export async function listOwlSendLedgerForWallet(params: {
  wallet: string
  limit?: number
}): Promise<OwlSendLedgerRow[]> {
  const db = getSupabaseAdmin()
  const limit = Math.min(100, Math.max(1, params.limit ?? 40))
  const { data, error } = await db
    .from('owl_send_ledger')
    .select('*')
    .eq('from_wallet', params.wallet)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map(normalizeRow)
}

function normalizeRow(raw: Record<string, unknown>): OwlSendLedgerRow {
  const linesRaw = raw.lines
  const lines = Array.isArray(linesRaw) ? (linesRaw as OwlSendLedgerLine[]) : []
  return {
    id: String(raw.id),
    from_wallet: String(raw.from_wallet),
    mode: raw.mode as OwlSendLedgerMode,
    asset_kind: raw.asset_kind as OwlSendLedgerAssetKind,
    tx_signature: String(raw.tx_signature),
    recipient_count: Number(raw.recipient_count),
    asset_count: Number(raw.asset_count),
    fee_lamports: raw.fee_lamports == null ? null : Number(raw.fee_lamports),
    batch_index: raw.batch_index == null ? null : Number(raw.batch_index),
    lines,
    created_at: String(raw.created_at),
  }
}
