import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type Gen2WhitelistWalletRow = {
  wallet_address: string
  created_at: string
  created_by_wallet: string | null
  note: string | null
}

export async function isWalletOnGen2Whitelist(wallet: string): Promise<boolean> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return false

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('gen2_whitelist_wallets')
    .select('wallet_address')
    .eq('wallet_address', w)
    .maybeSingle()

  if (error) {
    console.error('isWalletOnGen2Whitelist:', error.message)
    return false
  }
  return !!data?.wallet_address
}

export async function listGen2WhitelistWallets(limit: number): Promise<Gen2WhitelistWalletRow[]> {
  const admin = getSupabaseAdmin()
  const cap = Math.min(2000, Math.max(1, Math.floor(limit)))
  const { data, error } = await admin
    .from('gen2_whitelist_wallets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(cap)

  if (error) {
    console.error('listGen2WhitelistWallets:', error.message)
    return []
  }
  return (data ?? []) as Gen2WhitelistWalletRow[]
}

export async function addGen2WhitelistWallet(input: {
  wallet: string
  createdByWallet: string
  note?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = normalizeSolanaWalletAddress(input.wallet)
  if (!w) return { ok: false, error: 'Invalid wallet address' }

  const admin = getSupabaseAdmin()
  const { error } = await admin.from('gen2_whitelist_wallets').upsert(
    {
      wallet_address: w,
      created_by_wallet: input.createdByWallet.trim(),
      note: input.note?.trim().slice(0, 200) || null,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'wallet_address' }
  )

  if (error) {
    console.error('addGen2WhitelistWallet:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function removeGen2WhitelistWallet(wallet: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return { ok: false, error: 'Invalid wallet address' }

  const admin = getSupabaseAdmin()
  const { error } = await admin.from('gen2_whitelist_wallets').delete().eq('wallet_address', w)

  if (error) {
    console.error('removeGen2WhitelistWallet:', error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
