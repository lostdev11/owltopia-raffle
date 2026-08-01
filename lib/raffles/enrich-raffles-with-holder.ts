import type { Raffle } from '@/lib/types'
import { getActivePartnerCommunityCreatorRows } from '@/lib/raffles/partner-communities'
import { getWalletsWithAdminRole } from '@/lib/db/admins'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'

export type EnrichRafflesWithCreatorHolderOptions = {
  /**
   * @deprecated No longer used — holder badge / live DAS lookups were removed from list enrichment
   * to save Helius credits. Kept for call-site compatibility.
   */
  budgetMs?: number
  /**
   * @deprecated No longer used — see budgetMs.
   */
  holderLookupMode?: 'list' | 'full'
}

/**
 * Enriches raffles with partner/admin display fields for cards and detail.
 * Does not call Helius — `creator_is_holder` is always false (badge removed; fee tiers
 * still resolve via getCreatorFeeTier on create/purchase/settlement).
 */
export async function enrichRafflesWithCreatorHolder(
  raffles: Raffle[],
  _options?: EnrichRafflesWithCreatorHolderOptions
): Promise<
  (Raffle & {
    creator_is_holder: boolean
    creator_is_partner: boolean
    creator_partner_display_name: string | null
    creator_partner_table_label: string | null
    creator_partner_logo_url: string | null
    description_urls_clickable: boolean
  })[]
> {
  if (!raffles.length) return []

  const wallets = new Set<string>()
  for (const r of raffles) {
    const w = (r.creator_wallet || r.created_by || '').trim()
    if (w) wallets.add(w)
  }

  const partnerRows = await getActivePartnerCommunityCreatorRows()
  const partnerWallets = new Set(partnerRows.map((r) => r.creator_wallet))
  const partnerTableLabelByWallet = new Map(
    partnerRows.map((r) => [r.creator_wallet, r.display_label] as const)
  )
  const partnerLogoByWallet = new Map(
    partnerRows
      .filter((r) => r.logo_url)
      .map((r) => [r.creator_wallet, r.logo_url!] as const)
  )
  const partnerProfileNames =
    partnerRows.length > 0
      ? await getDisplayNamesByWallets(partnerRows.map((r) => r.creator_wallet))
      : {}
  const adminWallets = await getWalletsWithAdminRole(Array.from(wallets))

  return raffles.map((r) => {
    const w = (r.creator_wallet || r.created_by || '').trim()
    const isPartner = w ? partnerWallets.has(w) : false
    const profileName = w ? (partnerProfileNames[w]?.trim() ?? '') : ''
    const tableLabel = w ? partnerTableLabelByWallet.get(w) : null
    let creator_partner_display_name: string | null = null
    if (isPartner) {
      if (profileName) creator_partner_display_name = profileName
      else if (tableLabel?.trim()) creator_partner_display_name = tableLabel.trim()
    }
    const creator_partner_table_label =
      isPartner && tableLabel?.trim() ? tableLabel.trim() : null
    const creator_partner_logo_url =
      isPartner && w && partnerLogoByWallet.get(w) ? partnerLogoByWallet.get(w)! : null
    return {
      ...r,
      creator_is_holder: false,
      creator_is_partner: isPartner,
      creator_partner_display_name,
      creator_partner_table_label,
      creator_partner_logo_url,
      description_urls_clickable: w ? adminWallets.has(w) : false,
    }
  })
}
