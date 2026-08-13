import { NextResponse } from 'next/server'

import { isOwlVisionAdmin } from '@/lib/admin/access'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import type { OwlCenterPresaleTenantAdmin } from '@/lib/owl-center-presale/types'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export async function isOwlCenterPartnerCommunityWallet(wallet: string): Promise<boolean> {
  const tier = await getCreatorFeeTier(wallet, { skipCache: true })
  return tier.reason === 'partner_community'
}

export async function requirePartnerOrAdminForPresale(
  sessionWallet: string
): Promise<{ ok: true; isAdmin: boolean } | { ok: false; response: NextResponse }> {
  const isAdmin = await isOwlVisionAdmin(sessionWallet)
  if (isAdmin) return { ok: true, isAdmin: true }
  const isPartner = await isOwlCenterPartnerCommunityWallet(sessionWallet)
  if (!isPartner) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Partner community access required to manage partner presales.' },
        { status: 403 }
      ),
    }
  }
  return { ok: true, isAdmin: false }
}

export function tenantOwnedByWallet(
  tenant: Pick<OwlCenterPresaleTenantAdmin, 'created_by_wallet' | 'partner_wallet' | 'treasury_wallet'>,
  wallet: string
): boolean {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return false
  const created = normalizeSolanaWalletAddress(tenant.created_by_wallet ?? '')
  if (created && created === w) return true
  const partner = normalizeSolanaWalletAddress(tenant.partner_wallet ?? '')
  if (partner && partner === w) return true
  return false
}

/** Gift allowed for Owltopia admins, or for the partner owner when campaign is approved. */
export function canGiftOwlCenterPresaleCredits(params: {
  tenant: OwlCenterPresaleTenantAdmin
  actorWallet: string
  isAdmin: boolean
}): boolean {
  if (params.isAdmin) return true
  if (params.tenant.approval_status !== 'approved') return false
  return tenantOwnedByWallet(params.tenant, params.actorWallet)
}
