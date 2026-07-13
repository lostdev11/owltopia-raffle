import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type OwlCenterPartnerStatus = 'approved' | 'revoked'

export type OwlCenterPartner = {
  id: string
  wallet: string
  label: string | null
  notes: string | null
  status: OwlCenterPartnerStatus
  added_by_wallet: string | null
  created_at: string
  updated_at: string
}

/** Whether this wallet is an approved launchpad partner. */
export async function isApprovedOwlCenterPartner(wallet: string): Promise<boolean> {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) return false

  const { data, error } = await getSupabaseAdmin()
    .from('owl_center_partners')
    .select('status')
    .eq('wallet', normalized)
    .eq('status', 'approved')
    .maybeSingle()

  if (error) {
    console.error('owl_center_partners check:', error.message || 'Unknown error')
    return false
  }
  return !!data
}

export async function listOwlCenterPartners(): Promise<OwlCenterPartner[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('owl_center_partners')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('owl_center_partners list:', error.message || 'Unknown error')
    return []
  }
  return (data ?? []) as OwlCenterPartner[]
}

/** Approve a partner wallet (insert or re-approve). Returns null on invalid wallet or DB error. */
export async function upsertOwlCenterPartner(input: {
  wallet: string
  label?: string | null
  notes?: string | null
  addedByWallet?: string | null
}): Promise<OwlCenterPartner | null> {
  const normalized = normalizeSolanaWalletAddress(input.wallet)
  if (!normalized) return null

  const { data, error } = await getSupabaseAdmin()
    .from('owl_center_partners')
    .upsert(
      {
        wallet: normalized,
        label: input.label?.trim() || null,
        notes: input.notes?.trim() || null,
        status: 'approved',
        added_by_wallet: input.addedByWallet ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet' }
    )
    .select('*')
    .single()

  if (error) {
    console.error('owl_center_partners upsert:', error.message || 'Unknown error')
    return null
  }
  return data as OwlCenterPartner
}

export async function setOwlCenterPartnerStatus(
  id: string,
  status: OwlCenterPartnerStatus
): Promise<OwlCenterPartner | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('owl_center_partners')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error('owl_center_partners status update:', error.message || 'Unknown error')
    return null
  }
  return data as OwlCenterPartner
}
