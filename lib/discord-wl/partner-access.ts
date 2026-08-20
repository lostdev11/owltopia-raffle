import { NextResponse } from 'next/server'
import { isAdmin } from '@/lib/db/admins'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { getPartnerRaffleVisibilityEntitlementForCreatorWallet } from '@/lib/db/partner-community-creators-admin'
import {
  getDiscordWlCampaignById,
  type DiscordWlCampaignRow,
} from '@/lib/db/discord-wl-campaigns'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export async function requirePartnerHubWallet(wallet: string): Promise<true | NextResponse> {
  const [feeTier, admin] = await Promise.all([getCreatorFeeTier(wallet, { skipCache: true }), isAdmin(wallet)])
  if (feeTier.reason === 'partner_community' || admin) return true
  return NextResponse.json({ error: 'Partner program access required.' }, { status: 403 })
}

export async function canManageDiscordWlCampaign(
  wallet: string,
  campaign: DiscordWlCampaignRow
): Promise<boolean> {
  if (await isAdmin(wallet)) return true
  if (walletsEqualSolana(campaign.created_by_wallet, wallet)) return true
  const entitlement = await getPartnerRaffleVisibilityEntitlementForCreatorWallet(wallet)
  const tenant = entitlement.discordPartnerTenantId?.trim()
  return Boolean(tenant && tenant === campaign.partner_tenant_id)
}

export async function loadManagedDiscordWlCampaign(
  wallet: string,
  idRaw: string
): Promise<DiscordWlCampaignRow | NextResponse> {
  const id = Number(idRaw)
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })
  }
  const campaign = await getDiscordWlCampaignById(id)
  if (!campaign) return NextResponse.json({ error: 'Whitelist spot not found' }, { status: 404 })
  if (!(await canManageDiscordWlCampaign(wallet, campaign))) {
    return NextResponse.json({ error: 'You cannot manage this whitelist spot.' }, { status: 403 })
  }
  return campaign
}
