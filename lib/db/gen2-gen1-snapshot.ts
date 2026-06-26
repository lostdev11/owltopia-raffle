import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

/**
 * Frozen Owltopia Gen1 holder snapshot (migration 142) — allowlist source for the
 * Candy Machine `gen1` guard group merkle root + proofs (AIRDROP phase).
 */

export type Gen1SnapshotRow = {
  wallet: string
  gen1_nft_count: number
  source: 'chain' | 'csv'
}

export type Gen1SnapshotUpsertResult = {
  upserted: number
  failed: Array<{ wallet: string; error: string }>
}

export type Gen1SnapshotSummary = {
  wallets: number
  total_nfts: number
  /** Largest single-wallet Gen1 holding — minimum safe `mintLimit` for the `gen1` guard group. */
  max_nfts_per_wallet: number
  last_updated_at: string | null
}

const UPSERT_CHUNK = 500

export async function bulkUpsertGen1Snapshot(
  rows: Array<{ wallet: string; gen1_nft_count: number }>,
  source: 'chain' | 'csv'
): Promise<Gen1SnapshotUpsertResult> {
  const admin = getSupabaseAdmin()
  const failed: Gen1SnapshotUpsertResult['failed'] = []
  const valid: Array<{ wallet: string; gen1_nft_count: number; source: string; updated_at: string }> = []
  const now = new Date().toISOString()
  const seen = new Set<string>()

  for (const row of rows) {
    const wallet = normalizeSolanaWalletAddress(row.wallet)
    if (!wallet) {
      failed.push({ wallet: row.wallet, error: 'Invalid wallet' })
      continue
    }
    if (seen.has(wallet)) continue
    seen.add(wallet)
    const count = Math.floor(row.gen1_nft_count)
    if (!Number.isFinite(count) || count <= 0) {
      failed.push({ wallet, error: `gen1_nft_count must be > 0 (got ${row.gen1_nft_count})` })
      continue
    }
    valid.push({ wallet, gen1_nft_count: count, source, updated_at: now })
  }

  let upserted = 0
  for (let i = 0; i < valid.length; i += UPSERT_CHUNK) {
    const chunk = valid.slice(i, i + UPSERT_CHUNK)
    const { error } = await admin.from('gen2_gen1_airdrop_snapshot').upsert(chunk, { onConflict: 'wallet' })
    if (error) {
      for (const r of chunk) failed.push({ wallet: r.wallet, error: error.message })
      continue
    }
    upserted += chunk.length
  }

  return { upserted, failed }
}

/** Full refresh: wipe the snapshot, then insert. Use before setting a new merkle root. */
export async function replaceGen1Snapshot(
  rows: Array<{ wallet: string; gen1_nft_count: number }>,
  source: 'chain' | 'csv'
): Promise<Gen1SnapshotUpsertResult> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('gen2_gen1_airdrop_snapshot').delete().neq('wallet', '')
  if (error) throw new Error(error.message)
  return bulkUpsertGen1Snapshot(rows, source)
}

/**
 * Frozen Gen1 NFT count for a single wallet from the snapshot allowlist — the exact
 * per-wallet allocation the on-chain `gen1` candy guard enforces (merkle root + proof).
 * Returns 0 when the wallet is not snapshotted or the table is missing (migration 142).
 *
 * Used as a floor for the live DAS holder scan so a flaky / rate-limited Helius response
 * can't under-report a holder's count and wrongly block their remaining AIRDROP claims.
 */
export async function getGen1SnapshotCount(wallet: string): Promise<number> {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) return 0
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('gen2_gen1_airdrop_snapshot')
    .select('gen1_nft_count')
    .eq('wallet', normalized)
    .maybeSingle()
  if (error) {
    // Migration 142 not applied yet — treat as no snapshot.
    if (error.message.includes('gen2_gen1_airdrop_snapshot')) return 0
    throw new Error(error.message)
  }
  const count = Number((data as { gen1_nft_count?: number } | null)?.gen1_nft_count ?? 0)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/**
 * Every snapshotted Gen1 holder wallet — canonical allowlist for the Candy Machine
 * `gen1` guard group (merkle root + proofs). Sorted ascending so the root is deterministic.
 */
export async function listGen1MerkleWallets(): Promise<string[]> {
  const admin = getSupabaseAdmin()
  const page = 1000
  let from = 0
  const wallets: string[] = []
  for (;;) {
    const { data, error } = await admin
      .from('gen2_gen1_airdrop_snapshot')
      .select('wallet')
      .order('wallet', { ascending: true })
      .range(from, from + page - 1)
    if (error) {
      // Migration 142 not applied yet — treat as empty snapshot.
      if (error.message.includes('gen2_gen1_airdrop_snapshot')) return []
      throw new Error(error.message)
    }
    const rows = data ?? []
    for (const r of rows) {
      wallets.push(String((r as { wallet: string }).wallet))
    }
    if (rows.length < page) break
    from += page
  }
  return wallets
}

export async function getGen1SnapshotSummary(): Promise<Gen1SnapshotSummary> {
  const admin = getSupabaseAdmin()
  const { data, error, count } = await admin
    .from('gen2_gen1_airdrop_snapshot')
    .select('gen1_nft_count,updated_at', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) {
    if (error.message.includes('gen2_gen1_airdrop_snapshot')) {
      return { wallets: 0, total_nfts: 0, max_nfts_per_wallet: 0, last_updated_at: null }
    }
    throw new Error(error.message)
  }

  const last = (data ?? [])[0] as { updated_at?: string } | undefined

  // Sum + max nft counts (paginated; snapshot is small — Gen1 holder count scale).
  let totalNfts = 0
  let maxNfts = 0
  const page = 1000
  let from = 0
  for (;;) {
    const { data: rows, error: e } = await admin
      .from('gen2_gen1_airdrop_snapshot')
      .select('gen1_nft_count')
      .order('wallet', { ascending: true })
      .range(from, from + page - 1)
    if (e) throw new Error(e.message)
    const batch = rows ?? []
    for (const r of batch) {
      const n = Number((r as { gen1_nft_count?: number }).gen1_nft_count ?? 0)
      totalNfts += n
      if (n > maxNfts) maxNfts = n
    }
    if (batch.length < page) break
    from += page
  }

  return {
    wallets: count ?? 0,
    total_nfts: totalNfts,
    max_nfts_per_wallet: maxNfts,
    last_updated_at: last?.updated_at ? String(last.updated_at) : null,
  }
}
