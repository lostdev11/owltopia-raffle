import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

/**
 * Gen2 AIRDROP "switch wallet for mint" delegations (migration 170).
 *
 * Maps a Gen1 holder's wallet (`source_wallet`, holds the NFT) to a different
 * `mint_wallet` so the holder can claim their free Gen2 from another wallet without
 * transferring the Gen1. Honored by the live eligibility resolver
 * (`lib/owl-center/gen2-mint-delegation.ts`) and by the merkle snapshot via
 * `applyGen1Delegations` below.
 */

const TABLE = 'gen2_gen1_mint_delegations'

export type Gen1MintDelegation = {
  source_wallet: string
  mint_wallet: string
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Migration 170 not applied yet — treat the table as empty rather than throwing. */
function isMissingTableError(message: string | undefined): boolean {
  return Boolean(message && message.includes(TABLE))
}

export async function listDelegations(): Promise<Gen1MintDelegation[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from(TABLE)
    .select('source_wallet,mint_wallet,note,created_by,created_at,updated_at')
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingTableError(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as Gen1MintDelegation[]
}

export async function getDelegationByMintWallet(mintWallet: string): Promise<Gen1MintDelegation | null> {
  const wallet = normalizeSolanaWalletAddress(mintWallet)
  if (!wallet) return null
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from(TABLE)
    .select('source_wallet,mint_wallet,note,created_by,created_at,updated_at')
    .eq('mint_wallet', wallet)
    .maybeSingle()
  if (error) {
    if (isMissingTableError(error.message)) return null
    throw new Error(error.message)
  }
  return (data as Gen1MintDelegation | null) ?? null
}

export async function getDelegationBySourceWallet(sourceWallet: string): Promise<Gen1MintDelegation | null> {
  const wallet = normalizeSolanaWalletAddress(sourceWallet)
  if (!wallet) return null
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from(TABLE)
    .select('source_wallet,mint_wallet,note,created_by,created_at,updated_at')
    .eq('source_wallet', wallet)
    .maybeSingle()
  if (error) {
    if (isMissingTableError(error.message)) return null
    throw new Error(error.message)
  }
  return (data as Gen1MintDelegation | null) ?? null
}

export type UpsertDelegationResult =
  | { ok: true; delegation: Gen1MintDelegation }
  | { ok: false; error: string }

export async function upsertDelegation(args: {
  source_wallet: string
  mint_wallet: string
  note?: string | null
  created_by?: string | null
}): Promise<UpsertDelegationResult> {
  const source = normalizeSolanaWalletAddress(args.source_wallet)
  const mint = normalizeSolanaWalletAddress(args.mint_wallet)
  if (!source) return { ok: false, error: 'Invalid source wallet' }
  if (!mint) return { ok: false, error: 'Invalid mint wallet' }
  if (source === mint) return { ok: false, error: 'Source and mint wallet must be different' }

  // Prevent delegation chains / ambiguity: a mint wallet must not also be a source,
  // and a source must not already be someone else's mint wallet.
  const [mintAsSource, sourceAsMint] = await Promise.all([
    getDelegationBySourceWallet(mint),
    getDelegationByMintWallet(source),
  ])
  if (mintAsSource) {
    return { ok: false, error: 'Mint wallet is already a delegation source — remove that mapping first' }
  }
  if (sourceAsMint) {
    return { ok: false, error: 'Source wallet is already a delegation mint target — remove that mapping first' }
  }

  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from(TABLE)
    .upsert(
      {
        source_wallet: source,
        mint_wallet: mint,
        note: args.note?.trim() ? args.note.trim() : null,
        created_by: args.created_by ?? null,
        updated_at: now,
      },
      { onConflict: 'source_wallet' }
    )
    .select('source_wallet,mint_wallet,note,created_by,created_at,updated_at')
    .maybeSingle()

  if (error) {
    // Unique violation on mint_wallet (already mapped from a different source).
    if (error.code === '23505' || error.message.toLowerCase().includes('duplicate')) {
      return { ok: false, error: 'That mint wallet is already mapped from a different source wallet' }
    }
    return { ok: false, error: error.message }
  }
  if (!data) return { ok: false, error: 'Upsert returned no row' }
  return { ok: true, delegation: data as Gen1MintDelegation }
}

export async function deleteDelegation(sourceWallet: string): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const source = normalizeSolanaWalletAddress(sourceWallet)
  if (!source) return { ok: false, error: 'Invalid source wallet' }
  const admin = getSupabaseAdmin()
  const { error, count } = await admin
    .from(TABLE)
    .delete({ count: 'exact' })
    .eq('source_wallet', source)
  if (error) return { ok: false, error: error.message }
  return { ok: true, deleted: count ?? 0 }
}

/**
 * Pure substitution: rewrite `source_wallet` snapshot rows to their `mint_wallet` so the
 * merkle allowlist gates the delegated wallet (the one that actually mints).
 *
 * - If a source wallet appears in `rows`, its count moves to the mint wallet.
 * - If a source wallet has no row (e.g. CSV omitted it), the mint wallet is added
 *   with count 1 (the live eligibility check enforces the real per-NFT amount at mint time).
 * - If the mint wallet already has a row, counts are summed.
 *
 * Exported for unit testing (scripts/test-gen2-gen1-delegations.ts).
 */
export function substituteGen1Delegations(
  rows: Array<{ wallet: string; gen1_nft_count: number }>,
  delegations: Array<{ source_wallet: string; mint_wallet: string }>
): Array<{ wallet: string; gen1_nft_count: number }> {
  if (delegations.length === 0) return rows

  const sourceToMint = new Map<string, string>()
  for (const d of delegations) sourceToMint.set(d.source_wallet, d.mint_wallet)

  const counts = new Map<string, number>()
  for (const row of rows) {
    const wallet = normalizeSolanaWalletAddress(row.wallet) ?? row.wallet
    const count = Math.max(0, Math.floor(row.gen1_nft_count))
    if (count <= 0) continue
    const target = sourceToMint.get(wallet) ?? wallet
    counts.set(target, (counts.get(target) ?? 0) + count)
  }

  // Ensure every delegated mint wallet is present even if the source had no scanned row.
  for (const d of delegations) {
    if (!counts.has(d.mint_wallet)) counts.set(d.mint_wallet, 1)
  }

  return [...counts.entries()]
    .map(([wallet, gen1_nft_count]) => ({ wallet, gen1_nft_count }))
    .sort((a, b) => (a.wallet < b.wallet ? -1 : 1))
}

/**
 * Apply the stored delegations to snapshot rows when building the Gen1 holder snapshot
 * (chain scan or CSV upload). Thin DB wrapper around {@link substituteGen1Delegations}.
 */
export async function applyGen1Delegations(
  rows: Array<{ wallet: string; gen1_nft_count: number }>
): Promise<Array<{ wallet: string; gen1_nft_count: number }>> {
  const delegations = await listDelegations()
  return substituteGen1Delegations(rows, delegations)
}
