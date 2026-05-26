import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const MAX_WALLET_LINKS_PER_PRIMARY = 5

export type WalletLinkRow = {
  primary_wallet: string
  linked_wallet: string
  created_at: string
}

export async function getPrimaryWalletForAddress(wallet: string): Promise<string | null> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return null

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('wallet_links')
    .select('primary_wallet')
    .eq('linked_wallet', w)
    .maybeSingle()

  if (error) {
    console.error('getPrimaryWalletForAddress:', error.message)
    return w
  }

  const primary =
    data?.primary_wallet != null ? normalizeSolanaWalletAddress(String(data.primary_wallet)) : null
  return primary ?? w
}

export async function listLinkedWalletsForPrimary(primaryWallet: string): Promise<WalletLinkRow[]> {
  const primary = normalizeSolanaWalletAddress(primaryWallet)
  if (!primary) return []

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('wallet_links')
    .select('*')
    .eq('primary_wallet', primary)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('listLinkedWalletsForPrimary:', error.message)
    return []
  }
  return (data ?? []) as WalletLinkRow[]
}

export async function countLinkedWalletsForPrimary(primaryWallet: string): Promise<number> {
  const rows = await listLinkedWalletsForPrimary(primaryWallet)
  return rows.length
}

/** Primary + all linked wallets (unique, normalized). */
export async function getWalletClusterAddresses(primaryWallet: string): Promise<string[]> {
  const primary = normalizeSolanaWalletAddress(primaryWallet)
  if (!primary) return []

  const linked = await listLinkedWalletsForPrimary(primary)
  const set = new Set<string>([primary])
  for (const row of linked) {
    const l = normalizeSolanaWalletAddress(row.linked_wallet)
    if (l) set.add(l)
  }
  return [...set]
}

export type WalletLinkInsertResult =
  | { ok: true }
  | { ok: false; code: 'invalid' | 'self' | 'limit' | 'linked_taken' | 'primary_is_linked' | 'linked_is_primary' | 'db'; message: string }

export async function insertWalletLink(
  primaryWallet: string,
  linkedWallet: string
): Promise<WalletLinkInsertResult> {
  const primary = normalizeSolanaWalletAddress(primaryWallet)
  const linked = normalizeSolanaWalletAddress(linkedWallet)
  if (!primary || !linked) {
    return { ok: false, code: 'invalid', message: 'Invalid wallet address' }
  }
  if (walletsEqualSolana(primary, linked)) {
    return { ok: false, code: 'self', message: 'Cannot link a wallet to itself' }
  }

  const count = await countLinkedWalletsForPrimary(primary)
  if (count >= MAX_WALLET_LINKS_PER_PRIMARY) {
    return {
      ok: false,
      code: 'limit',
      message: `You can link at most ${MAX_WALLET_LINKS_PER_PRIMARY} additional wallets`,
    }
  }

  const admin = getSupabaseAdmin()

  const { data: primaryAsLinked } = await admin
    .from('wallet_links')
    .select('primary_wallet')
    .eq('linked_wallet', primary)
    .maybeSingle()

  if (primaryAsLinked?.primary_wallet) {
    return {
      ok: false,
      code: 'primary_is_linked',
      message:
        'Your primary wallet is linked to another account. Sign in with that primary wallet to manage links.',
    }
  }

  const { data: linkedExisting } = await admin
    .from('wallet_links')
    .select('primary_wallet')
    .eq('linked_wallet', linked)
    .maybeSingle()

  if (linkedExisting?.primary_wallet) {
    return {
      ok: false,
      code: 'linked_taken',
      message: 'That wallet is already linked to another Owltopia account.',
    }
  }

  const { data: linkedAsPrimary } = await admin
    .from('wallet_links')
    .select('linked_wallet')
    .eq('primary_wallet', linked)
    .limit(1)

  if ((linkedAsPrimary ?? []).length > 0) {
    return {
      ok: false,
      code: 'linked_is_primary',
      message:
        'That wallet already has its own linked wallets. Remove those links first or use it as your primary.',
    }
  }

  const { error } = await admin.from('wallet_links').insert({
    primary_wallet: primary,
    linked_wallet: linked,
    created_at: new Date().toISOString(),
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: 'linked_taken', message: 'That wallet is already linked.' }
    }
    console.error('insertWalletLink:', error.message)
    return { ok: false, code: 'db', message: error.message }
  }

  return { ok: true }
}

export async function deleteWalletLink(
  primaryWallet: string,
  linkedWallet: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const primary = normalizeSolanaWalletAddress(primaryWallet)
  const linked = normalizeSolanaWalletAddress(linkedWallet)
  if (!primary || !linked) {
    return { ok: false, message: 'Invalid wallet address' }
  }

  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('wallet_links')
    .delete()
    .eq('primary_wallet', primary)
    .eq('linked_wallet', linked)

  if (error) {
    console.error('deleteWalletLink:', error.message)
    return { ok: false, message: error.message }
  }
  return { ok: true }
}

/** True when this wallet is the cluster primary (not linked under someone else). */
export async function isClusterPrimaryWallet(wallet: string): Promise<boolean> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return false
  const primary = await getPrimaryWalletForAddress(w)
  return !!primary && walletsEqualSolana(primary, w)
}
