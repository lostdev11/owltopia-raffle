import { parseMintDetailsConfig } from '@/lib/owl-center/launch-mint-config'
import { isLaunchRoyaltyLocked, launchSellerFeeBasisPoints } from '@/lib/owl-center/royalty'
import { parseWalletSplitsFromBody, walletSplitsEqual } from '@/lib/owl-center/wallet-splits'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import type { updateOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'

export const MINT_CONFIG_BODY_KEYS = new Set([
  'mint_price',
  'public_price',
  'wl_price',
  'currency',
  'wallet_mint_limit',
  'launch_date',
  'launch_deadline_at',
  'presale_enabled',
  'creator_presale_enabled',
  'presale_supply',
  'presale_overage_supply',
  'presale_start',
  'wl_enabled',
  'creator_wl_enabled',
  'wl_supply',
  'wl_start',
  'public_start',
  'public_phase_start',
  'phase_schedule',
  'royalty_percent',
  'seller_fee_basis_points',
  'royalty_splits',
  'mint_fund_splits',
  'treasury_wallet',
])

export function bodyHasMintConfigFields(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((k) => MINT_CONFIG_BODY_KEYS.has(k))
}

export function buildMintDetailsPatchFromBody(
  body: Record<string, unknown>,
  launch: OwlCenterLaunchPublic
): Parameters<typeof updateOwlCenterLaunchByIdAdmin>[1] | { error: string } {
  const parsed = parseMintDetailsConfig({
    ...body,
    total_supply: body.total_supply ?? launch.total_supply,
    presale_enabled: body.presale_enabled ?? launch.creator_presale_enabled,
    wl_enabled: body.wl_enabled ?? launch.creator_wl_enabled,
    mint_price: body.mint_price ?? body.public_price ?? launch.creator_mint_price,
    currency: body.currency ?? launch.creator_mint_currency,
    // Form has no airdrop field; preserve the existing GEN1 pool so saves don't zero it.
    airdrop_supply: body.airdrop_supply ?? launch.airdrop_supply,
  })
  if ('error' in parsed) return parsed

  if (
    isLaunchRoyaltyLocked(launch) &&
    parsed.seller_fee_basis_points !== launchSellerFeeBasisPoints(launch)
  ) {
    return {
      error:
        'Secondary royalty is locked after Candy Machine deploy. Unminted items and already-minted NFTs keep the on-chain rate set at deploy.',
    }
  }

  if (isLaunchRoyaltyLocked(launch)) {
    const royaltySplits = parseWalletSplitsFromBody(body, 'royalty_splits', 'Secondary royalty split')
    if (royaltySplits && 'error' in royaltySplits) return royaltySplits
    if (royaltySplits && !walletSplitsEqual(royaltySplits, launch.royalty_splits)) {
      return {
        error:
          'Secondary royalty split is locked after Candy Machine deploy. Recipient wallets are baked into the Candy Machine at deploy.',
      }
    }

    const mintFundSplits = parseWalletSplitsFromBody(body, 'mint_fund_splits', 'Mint funds split')
    if (mintFundSplits && 'error' in mintFundSplits) return mintFundSplits
    if (mintFundSplits && !walletSplitsEqual(mintFundSplits, launch.mint_fund_splits)) {
      return {
        error: 'Mint funds split is locked after Candy Machine deploy.',
      }
    }
  }

  const patch: Parameters<typeof updateOwlCenterLaunchByIdAdmin>[1] = {
    total_supply: parsed.total_supply,
    presale_supply: parsed.presale_supply,
    wl_supply: parsed.wl_supply,
    public_supply: parsed.public_supply,
    airdrop_supply: parsed.airdrop_supply,
    presale_overage_supply: parsed.presale_overage_supply,
    wl_price_usdc: parsed.wl_price_usdc,
    public_price_usdc: parsed.public_price_usdc,
    wallet_mint_limit: parsed.wallet_mint_limit,
    launch_deadline_at: parsed.launch_deadline_at,
    phase_schedule: parsed.phase_schedule,
    creator_presale_enabled: parsed.creator_presale_enabled,
    creator_wl_enabled: parsed.creator_wl_enabled,
    creator_mint_price: parsed.creator_mint_price,
    creator_mint_currency: parsed.creator_mint_currency,
    creator_launch_date: parsed.launch_deadline_at,
    seller_fee_basis_points: parsed.seller_fee_basis_points,
  }

  if (body.royalty_splits !== undefined) {
    patch.royalty_splits = parsed.royalty_splits
  }
  if (body.mint_fund_splits !== undefined || body.treasury_wallet !== undefined) {
    patch.mint_fund_splits = parsed.mint_fund_splits
    patch.treasury_wallet = parsed.treasury_wallet
  }

  return patch
}
