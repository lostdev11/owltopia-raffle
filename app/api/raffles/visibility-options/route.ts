import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { getPartnerRaffleVisibilityEntitlementForCreatorWallet } from '@/lib/db/partner-community-creators-admin'
import { getActivePartnerCommunityWalletSet } from '@/lib/raffles/partner-communities'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * Whether the connected session wallet may set list_on_platform=false (partner raffle only).
 * Partner Pro+ gets the visibility control; `partnerDiscordLinked` tells the UI whether
 * create/winner webhooks can target that server's channels.
 * `isPartnerCommunityCreator` unlocks extra SPL prize tokens in the create form (beyond SOL/USDC for all creators).
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request)
    const sessionWallet = session?.wallet?.trim() ?? ''
    /** Create form: connected wallet may differ from SIWS session until user signs in. */
    const queryWallet = normalizeSolanaWalletAddress(
      request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    )
    // Prefer explicit `wallet` (connected adapter) so create-form preview matches the creator address.
    const feeTierWallet = queryWallet ?? (sessionWallet ? normalizeSolanaWalletAddress(sessionWallet) : null)

    const partnerWalletsP = getActivePartnerCommunityWalletSet()
    const feeTierP = feeTierWallet
      ? getCreatorFeeTier(feeTierWallet, { skipCache: false, listDisplayOnly: false })
      : Promise.resolve(null)

    if (!sessionWallet) {
      const [partnerWallets, feeTier] = await Promise.all([partnerWalletsP, feeTierP])
      return NextResponse.json({
        canSetLinkOnly: false,
        partnerDiscordLinked: false,
        isPartnerCommunityCreator: false,
        partnerTier: null,
        platformFeeBps: feeTier?.feeBps ?? null,
        platformFeeReason: feeTier?.reason ?? null,
        feeTierWallet: feeTierWallet ?? null,
      })
    }

    const [adminRole, entitlement, partnerWallets, feeTier] = await Promise.all([
      getAdminRole(sessionWallet),
      getPartnerRaffleVisibilityEntitlementForCreatorWallet(sessionWallet),
      partnerWalletsP,
      feeTierP,
    ])
    const partnerDiscordLinked =
      entitlement.discordPartnerTenantId != null && String(entitlement.discordPartnerTenantId).trim() !== ''
    const canSetLinkOnly = adminRole !== null || entitlement.canSetPartnerOnly
    const norm = normalizeSolanaWalletAddress(sessionWallet)
    let isPartnerCommunityCreator = false
    if (norm) {
      for (const w of partnerWallets) {
        if (walletsEqualSolana(w, norm)) {
          isPartnerCommunityCreator = true
          break
        }
      }
    }
    return NextResponse.json({
      canSetLinkOnly,
      partnerDiscordLinked,
      partnerTier: entitlement.partnerTier,
      isPartnerCommunityCreator,
      platformFeeBps: feeTier?.feeBps ?? null,
      platformFeeReason: feeTier?.reason ?? null,
      feeTierWallet: feeTierWallet ?? null,
    })
  } catch (e) {
    console.error('[GET /api/raffles/visibility-options]', e)
    return NextResponse.json({
      canSetLinkOnly: false,
      partnerDiscordLinked: false,
      isPartnerCommunityCreator: false,
      platformFeeBps: null,
      platformFeeReason: null,
    })
  }
}
