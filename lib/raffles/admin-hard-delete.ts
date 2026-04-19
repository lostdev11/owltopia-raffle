import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { Raffle } from '@/lib/types'

export const ADMIN_HARD_DELETE_REASON_MIN_CHARS = 10
export const ADMIN_HARD_DELETE_REASON_MAX_CHARS = 2000

/**
 * Persist audit row before permanently deleting a raffle (full admin only).
 * Table: migration 071_raffle_admin_deletion_audit.sql
 */
export async function recordRaffleAdminDeletion(opts: {
  raffle: Pick<
    Raffle,
    | 'id'
    | 'slug'
    | 'title'
    | 'creator_wallet'
    | 'created_by'
    | 'nft_mint_address'
    | 'prize_type'
    | 'status'
  >
  adminWallet: string
  deleteReason: string
}): Promise<void> {
  const admin = opts.adminWallet.trim()
  const reason = opts.deleteReason.trim()
  const r = opts.raffle
  const creator = (r.creator_wallet ?? r.created_by ?? '').trim() || null

  const { error } = await getSupabaseAdmin().from('raffle_admin_deletions').insert({
    raffle_id: r.id,
    admin_wallet: admin,
    delete_reason: reason,
    raffle_slug: r.slug,
    raffle_title: r.title,
    creator_wallet: creator,
    nft_mint_address: r.nft_mint_address?.trim() || null,
    prize_type: r.prize_type,
    raffle_status: r.status ?? null,
  })

  if (error) {
    console.error('[recordRaffleAdminDeletion]', error.message)
    throw new Error(error.message || 'Failed to record admin deletion audit')
  }
}
