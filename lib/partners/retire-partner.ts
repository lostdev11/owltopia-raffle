/**
 * Discord / Owl Vision → site Partner Spotlight retire path.
 * Soft-deactivates linked creators + spotlight brands; suspends Discord partner tenants.
 */
import {
  getDiscordGiveawayPartnerByGuildId,
  getDiscordGiveawayPartnerById,
  updateDiscordGiveawayPartner,
} from '@/lib/db/discord-giveaway-partners'
import {
  getPartnerCommunityCreatorByWallet,
  listPartnerCommunityCreatorsAdmin,
  updatePartnerCommunityCreator,
} from '@/lib/db/partner-community-creators-admin'
import {
  deactivatePartnerSpotlightBrandsForTenant,
  deactivatePartnerSpotlightBrandsMatchingName,
  partnerNameMatchesQuery,
} from '@/lib/db/partner-spotlight-brands'
import { clearPartnerCommunityWalletCache } from '@/lib/raffles/partner-communities'

export type RetirePartnerResult = {
  suspendedTenantIds: string[]
  deactivatedCreatorWallets: string[]
  deactivatedBrandSlugs: string[]
  messages: string[]
}

async function deactivateCreatorsByWallets(wallets: string[]): Promise<string[]> {
  const out: string[] = []
  for (const w of [...new Set(wallets.map((x) => x.trim()).filter(Boolean))]) {
    const row = await getPartnerCommunityCreatorByWallet(w)
    if (!row) continue
    if (!row.is_active) {
      out.push(w)
      continue
    }
    await updatePartnerCommunityCreator(w, { is_active: false })
    out.push(w)
  }
  return out
}

async function findCreatorWalletsMatchingName(name: string): Promise<string[]> {
  const rows = await listPartnerCommunityCreatorsAdmin()
  return rows
    .filter((r) => r.is_active)
    .filter((r) => partnerNameMatchesQuery(name, [r.display_label, r.creator_wallet]))
    .map((r) => r.creator_wallet)
}

async function findCreatorWalletsForTenant(tenantId: string): Promise<string[]> {
  const rows = await listPartnerCommunityCreatorsAdmin()
  return rows
    .filter((r) => r.discord_partner_tenant_id === tenantId)
    .map((r) => r.creator_wallet)
}

/**
 * Retire a partner so Partner Spotlight / fee allowlist stop featuring them.
 * Prefer soft deactivate (is_active=false) over hard delete.
 */
export async function retirePartnerCommunity(input: {
  /** Discord partner tenant UUID */
  tenantId?: string | null
  /** Discord guild snowflake — resolves to tenant when tenantId unset */
  guildId?: string | null
  /** Partner / brand display name (e.g. "ShonenSol", "Eapes") */
  brandName?: string | null
  /** Partner creator wallet */
  creatorWallet?: string | null
  /** When true, skip suspending the tenant (caller already set status=suspended) */
  skipTenantSuspend?: boolean
}): Promise<RetirePartnerResult> {
  const result: RetirePartnerResult = {
    suspendedTenantIds: [],
    deactivatedCreatorWallets: [],
    deactivatedBrandSlugs: [],
    messages: [],
  }

  let tenantId = typeof input.tenantId === 'string' ? input.tenantId.trim() : ''
  const guildId = typeof input.guildId === 'string' ? input.guildId.trim() : ''
  const brandName = typeof input.brandName === 'string' ? input.brandName.trim() : ''
  const creatorWallet = typeof input.creatorWallet === 'string' ? input.creatorWallet.trim() : ''

  if (!tenantId && guildId) {
    const byGuild = await getDiscordGiveawayPartnerByGuildId(guildId)
    if (byGuild) tenantId = byGuild.id
  }

  const tenantIdsToTouch = new Set<string>()
  if (tenantId) tenantIdsToTouch.add(tenantId)

  if (creatorWallet) {
    const creator = await getPartnerCommunityCreatorByWallet(creatorWallet)
    if (creator?.discord_partner_tenant_id) {
      tenantIdsToTouch.add(creator.discord_partner_tenant_id)
    }
    const deactivated = await deactivateCreatorsByWallets([creatorWallet])
    result.deactivatedCreatorWallets.push(...deactivated)
    if (creator?.display_label) {
      const brands = await deactivatePartnerSpotlightBrandsMatchingName(creator.display_label)
      result.deactivatedBrandSlugs.push(...brands)
    }
  }

  if (brandName) {
    const brands = await deactivatePartnerSpotlightBrandsMatchingName(brandName)
    result.deactivatedBrandSlugs.push(...brands)

    const wallets = await findCreatorWalletsMatchingName(brandName)
    const deactivated = await deactivateCreatorsByWallets(wallets)
    result.deactivatedCreatorWallets.push(...deactivated)

    for (const w of deactivated) {
      const row = await getPartnerCommunityCreatorByWallet(w)
      if (row?.discord_partner_tenant_id) tenantIdsToTouch.add(row.discord_partner_tenant_id)
    }

    // Also match Discord tenant names (often the community name).
    try {
      const { listDiscordGiveawayPartners } = await import('@/lib/db/discord-giveaway-partners')
      const tenants = await listDiscordGiveawayPartners()
      for (const t of tenants) {
        if (partnerNameMatchesQuery(brandName, [t.name])) {
          tenantIdsToTouch.add(t.id)
        }
      }
    } catch (e) {
      console.warn('[retirePartnerCommunity] tenant name scan failed:', e)
    }
  }

  for (const id of tenantIdsToTouch) {
    const tenant = await getDiscordGiveawayPartnerById(id)
    if (!tenant) continue

    if (!input.skipTenantSuspend && tenant.status !== 'suspended') {
      const updated = await updateDiscordGiveawayPartner(id, { status: 'suspended' })
      if (updated) {
        result.suspendedTenantIds.push(id)
        result.messages.push(`Suspended Discord partner tenant “${tenant.name}”.`)
      }
    } else if (tenant.status === 'suspended' || input.skipTenantSuspend) {
      result.messages.push(`Discord partner tenant “${tenant.name}” is suspended.`)
    }

    const wallets = await findCreatorWalletsForTenant(id)
    const deactivated = await deactivateCreatorsByWallets(wallets)
    result.deactivatedCreatorWallets.push(...deactivated)

    const byTenant = await deactivatePartnerSpotlightBrandsForTenant(id)
    result.deactivatedBrandSlugs.push(...byTenant)

    const byName = await deactivatePartnerSpotlightBrandsMatchingName(tenant.name)
    result.deactivatedBrandSlugs.push(...byName)
  }

  // Deduplicate
  result.suspendedTenantIds = [...new Set(result.suspendedTenantIds)]
  result.deactivatedCreatorWallets = [...new Set(result.deactivatedCreatorWallets)]
  result.deactivatedBrandSlugs = [...new Set(result.deactivatedBrandSlugs)]

  if (
    result.suspendedTenantIds.length === 0 &&
    result.deactivatedCreatorWallets.length === 0 &&
    result.deactivatedBrandSlugs.length === 0
  ) {
    result.messages.push(
      brandName || creatorWallet || guildId || tenantId
        ? 'No matching active partner creators or spotlight brands found.'
        : 'Nothing to retire — provide a brand name, creator wallet, or Discord guild/tenant.'
    )
  } else {
    if (result.deactivatedBrandSlugs.length) {
      result.messages.push(
        `Deactivated Partner Spotlight brand(s): ${result.deactivatedBrandSlugs.join(', ')}.`
      )
    }
    if (result.deactivatedCreatorWallets.length) {
      result.messages.push(
        `Deactivated partner creator wallet(s): ${result.deactivatedCreatorWallets.length}.`
      )
    }
  }

  clearPartnerCommunityWalletCache()
  return result
}
