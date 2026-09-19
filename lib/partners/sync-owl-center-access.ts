/**
 * Keep Owl Center launchpad access aligned with Partner Program allowlist.
 * No unified partner_id — sync by Solana wallet across the two tables.
 */
import {
  getOwlCenterPartnerByWallet,
  revokeOwlCenterPartnerByWallet,
  upsertOwlCenterPartner,
  type OwlCenterPartner,
} from '@/lib/db/owl-center-partners'
import {
  buildPartnerProOwlCenterSyncNotes,
  shouldReplacePartnerProOwlCenterNotes,
} from '@/lib/partners/sync-owl-center-access-notes'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export {
  PARTNER_PRO_OWL_CENTER_SYNC_NOTE,
  buildPartnerProOwlCenterSyncNotes,
  shouldReplacePartnerProOwlCenterNotes,
} from '@/lib/partners/sync-owl-center-access-notes'

export type SyncOwlCenterGrantResult = {
  wallet: string
  granted: boolean
  /** True when an owl_center_partners row was upserted to approved. */
  owlCenterPartnerId: string | null
}

export type SyncOwlCenterRevokeResult = {
  wallet: string
  revoked: boolean
}

async function reapproveOwlCenterPartnerRow(input: {
  wallet: string
  label?: string | null
  notes?: string | null
  addedByWallet?: string | null
  replaceNotes: boolean
}): Promise<OwlCenterPartner | null> {
  const patch: Record<string, unknown> = {
    status: 'approved',
    updated_at: new Date().toISOString(),
  }
  if (input.label !== undefined) {
    const label = input.label?.trim() || null
    if (label) patch.label = label
  }
  if (input.replaceNotes && input.notes !== undefined) {
    patch.notes = input.notes?.trim() || null
  }
  if (input.addedByWallet) {
    patch.added_by_wallet = input.addedByWallet
  }

  const { data, error } = await getSupabaseAdmin()
    .from('owl_center_partners')
    .update(patch)
    .eq('wallet', input.wallet)
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[reapproveOwlCenterPartnerRow]', error.message || 'Unknown error')
    return null
  }
  return (data as OwlCenterPartner | null) ?? null
}

/**
 * Grant (or re-approve) Owl Center launchpad access for an active Partner Program wallet.
 * Idempotent. Does not throw on DB failure — returns granted:false so Partner Pro approve still succeeds.
 * Preserves non-sync admin notes on existing rows.
 */
export async function grantOwlCenterAccessFromPartnerPro(input: {
  wallet: string
  label?: string | null
  addedByWallet?: string | null
  /** Extra note context (e.g. application id). Appended after the sync marker. */
  detail?: string | null
}): Promise<SyncOwlCenterGrantResult> {
  const wallet = normalizeSolanaWalletAddress(input.wallet)
  if (!wallet) {
    return { wallet: '', granted: false, owlCenterPartnerId: null }
  }

  const notes = buildPartnerProOwlCenterSyncNotes(input.detail)
  const existing = await getOwlCenterPartnerByWallet(wallet)

  if (existing) {
    const row = await reapproveOwlCenterPartnerRow({
      wallet,
      label: input.label ?? existing.label,
      notes,
      addedByWallet: input.addedByWallet ?? null,
      replaceNotes: shouldReplacePartnerProOwlCenterNotes(existing.notes),
    })
    if (!row) {
      return { wallet, granted: false, owlCenterPartnerId: null }
    }
    return { wallet, granted: true, owlCenterPartnerId: row.id }
  }

  const row = await upsertOwlCenterPartner({
    wallet,
    label: input.label ?? null,
    notes,
    addedByWallet: input.addedByWallet ?? null,
  })

  if (!row) {
    console.error('[grantOwlCenterAccessFromPartnerPro] upsert failed for', wallet)
    return { wallet, granted: false, owlCenterPartnerId: null }
  }

  return { wallet, granted: true, owlCenterPartnerId: row.id }
}

/**
 * Revoke Owl Center launchpad access for a Partner Program wallet (soft revoke).
 * Idempotent when already revoked or missing.
 */
export async function revokeOwlCenterAccessForPartnerWallet(
  wallet: string
): Promise<SyncOwlCenterRevokeResult> {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) {
    return { wallet: '', revoked: false }
  }

  const existing = await getOwlCenterPartnerByWallet(normalized)
  if (!existing) {
    return { wallet: normalized, revoked: false }
  }
  if (existing.status === 'revoked') {
    return { wallet: normalized, revoked: true }
  }

  const updated = await revokeOwlCenterPartnerByWallet(normalized)
  if (!updated) {
    console.error('[revokeOwlCenterAccessForPartnerWallet] revoke failed for', normalized)
    return { wallet: normalized, revoked: false }
  }
  return { wallet: normalized, revoked: true }
}

/**
 * After Partner Program wallet rename: move Owl Center approval to the new wallet.
 * Revokes the old row when present; grants/approves the new one when the partner stays active.
 */
export async function transferOwlCenterAccessForPartnerWalletRename(input: {
  fromWallet: string
  toWallet: string
  label?: string | null
  isActive: boolean
}): Promise<{ granted: boolean; revokedFrom: boolean }> {
  const from = normalizeSolanaWalletAddress(input.fromWallet)
  const to = normalizeSolanaWalletAddress(input.toWallet)
  if (!from || !to || from === to) {
    return { granted: false, revokedFrom: false }
  }

  const revoke = await revokeOwlCenterAccessForPartnerWallet(from)
  if (!input.isActive) {
    return { granted: false, revokedFrom: revoke.revoked }
  }

  const grant = await grantOwlCenterAccessFromPartnerPro({
    wallet: to,
    label: input.label,
    detail: `wallet rename from ${from.slice(0, 4)}…${from.slice(-4)}`,
  })
  return { granted: grant.granted, revokedFrom: revoke.revoked }
}
