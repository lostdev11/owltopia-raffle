import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

/**
 * Gen2 PRESALE "switch wallet for mint" delegations (migration 180).
 *
 * Maps a presale credit holder's wallet (`source_wallet`) to a different `mint_wallet`
 * so the holder can redeem presale credits from a safe wallet without moving purchase
 * records. Honored by the live eligibility resolver and the presale merkle allowlist.
 */

const TABLE = 'gen2_presale_mint_delegations'

export type PresaleMintDelegation = {
  source_wallet: string
  mint_wallet: string
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

function isMissingTableError(message: string | undefined): boolean {
  return Boolean(message && message.includes(TABLE))
}

export async function listPresaleDelegations(): Promise<PresaleMintDelegation[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from(TABLE)
    .select('source_wallet,mint_wallet,note,created_by,created_at,updated_at')
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingTableError(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as PresaleMintDelegation[]
}

export async function getPresaleDelegationByMintWallet(mintWallet: string): Promise<PresaleMintDelegation | null> {
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
  return (data as PresaleMintDelegation | null) ?? null
}

export async function getPresaleDelegationBySourceWallet(sourceWallet: string): Promise<PresaleMintDelegation | null> {
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
  return (data as PresaleMintDelegation | null) ?? null
}

export type UpsertPresaleDelegationResult =
  | { ok: true; delegation: PresaleMintDelegation }
  | { ok: false; error: string }

export async function upsertPresaleDelegation(args: {
  source_wallet: string
  mint_wallet: string
  note?: string | null
  created_by?: string | null
}): Promise<UpsertPresaleDelegationResult> {
  const source = normalizeSolanaWalletAddress(args.source_wallet)
  const mint = normalizeSolanaWalletAddress(args.mint_wallet)
  if (!source) return { ok: false, error: 'Invalid source wallet' }
  if (!mint) return { ok: false, error: 'Invalid mint wallet' }
  if (source === mint) return { ok: false, error: 'Source and mint wallet must be different' }

  const [mintAsSource, sourceAsMint] = await Promise.all([
    getPresaleDelegationBySourceWallet(mint),
    getPresaleDelegationByMintWallet(source),
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
    if (error.code === '23505' || error.message.toLowerCase().includes('duplicate')) {
      return { ok: false, error: 'That mint wallet is already mapped from a different source wallet' }
    }
    return { ok: false, error: error.message }
  }
  if (!data) return { ok: false, error: 'Upsert returned no row' }
  return { ok: true, delegation: data as PresaleMintDelegation }
}

export async function deletePresaleDelegation(
  sourceWallet: string
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const source = normalizeSolanaWalletAddress(sourceWallet)
  if (!source) return { ok: false, error: 'Invalid source wallet' }
  const admin = getSupabaseAdmin()
  const { error, count } = await admin.from(TABLE).delete({ count: 'exact' }).eq('source_wallet', source)
  if (error) return { ok: false, error: error.message }
  return { ok: true, deleted: count ?? 0 }
}

/**
 * Rewrite presale merkle allowlist wallets so delegated source wallets are replaced by their
 * mint wallet (the wallet that actually signs the mint tx).
 */
export function substitutePresaleDelegations(
  wallets: string[],
  delegations: Array<{ source_wallet: string; mint_wallet: string }>
): string[] {
  if (delegations.length === 0) return wallets

  const sourceToMint = new Map<string, string>()
  for (const d of delegations) sourceToMint.set(d.source_wallet, d.mint_wallet)

  const out = new Set<string>()
  for (const w of wallets) {
    out.add(sourceToMint.get(w) ?? w)
  }
  return [...out].sort()
}

export async function applyPresaleDelegations(wallets: string[]): Promise<string[]> {
  const delegations = await listPresaleDelegations()
  return substitutePresaleDelegations(wallets, delegations)
}
