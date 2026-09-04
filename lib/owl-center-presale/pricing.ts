import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'
import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { owlCenterPresalePlatformFeeUsdcPerSpot } from '@/lib/owl-center-presale/constants'
import type { OwlCenterPresaleTenantAdmin } from '@/lib/owl-center-presale/types'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type OwlCenterPresaleCampaignConfig = {
  priceUsdc: number
  platformFeeUsdcPerSpot: number
  presaleSupply: number
  solUsdPrice: number
  /** Partner receive wallet for spot proceeds. */
  partnerWallet: PublicKey
  /** Owltopia platform fee treasury. */
  platformFeeWallet: PublicKey
  maxSpotsPerPurchase: number
  maxCreditsPerWallet: number
}

export type OwlCenterPriceBreakdown = {
  unitPriceUsdc: number
  platformFeeUsdcPerSpot: number
  solUsdPrice: number
  /** Spot price only (partner proceeds), per spot. */
  unitPartnerLamports: bigint
  /** Platform fee per spot. */
  unitPlatformFeeLamports: bigint
  /** Spot + fee, per spot. */
  unitLamports: bigint
  partnerLamports: bigint
  platformFeeLamports: bigint
  totalLamports: bigint
  /**
   * Legacy alias for partner proceeds (compat with older confirm / UI fields).
   * Prefer partnerLamports.
   */
  treasuryLamports: bigint
}

/** Wallet that receives spot-price proceeds (partner_wallet, else legacy treasury_wallet). */
export function resolveOwlCenterPresalePartnerReceiveWallet(
  tenant: Pick<OwlCenterPresaleTenantAdmin, 'partner_wallet' | 'treasury_wallet'>
): string {
  const partner = normalizeSolanaWalletAddress(tenant.partner_wallet ?? '')
  if (partner) return partner
  const treasury = normalizeSolanaWalletAddress(tenant.treasury_wallet)
  if (!treasury) throw new Error('Partner receive wallet is not configured for this presale')
  return treasury
}

export function tenantToCampaignConfig(
  tenant: OwlCenterPresaleTenantAdmin,
  solUsdPrice: number,
  platformFeeWallet: string
): OwlCenterPresaleCampaignConfig {
  const partner = resolveOwlCenterPresalePartnerReceiveWallet(tenant)
  const feeTreasury = normalizeSolanaWalletAddress(platformFeeWallet)
  if (!feeTreasury) throw new Error('Platform fee treasury is not configured')
  return {
    priceUsdc: tenant.unit_price_usdc,
    platformFeeUsdcPerSpot: owlCenterPresalePlatformFeeUsdcPerSpot(),
    presaleSupply: tenant.presale_supply,
    solUsdPrice,
    partnerWallet: new PublicKey(partner),
    platformFeeWallet: new PublicKey(feeTreasury),
    maxSpotsPerPurchase: tenant.max_spots_per_purchase,
    maxCreditsPerWallet: tenant.max_credits_per_wallet,
  }
}

export function lamportsForUsdcAmount(usdc: number, solUsdPrice: number): bigint {
  if (!(usdc >= 0) || !Number.isFinite(usdc) || !(solUsdPrice > 0)) {
    throw new Error('Invalid USDC amount or SOL/USD price')
  }
  if (usdc === 0) return 0n
  const unitSol = usdc / solUsdPrice
  return BigInt(Math.round(unitSol * LAMPORTS_PER_SOL))
}

export function lamportsPerSpot(cfg: Pick<OwlCenterPresaleCampaignConfig, 'priceUsdc' | 'solUsdPrice'>): bigint {
  return lamportsForUsdcAmount(cfg.priceUsdc, cfg.solUsdPrice)
}

export function computeOwlCenterPurchaseLamports(
  cfg: Pick<
    OwlCenterPresaleCampaignConfig,
    'priceUsdc' | 'platformFeeUsdcPerSpot' | 'solUsdPrice'
  >,
  quantity: number
): OwlCenterPriceBreakdown {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error('quantity must be a positive integer')
  }
  const unitPartnerLamports = lamportsForUsdcAmount(cfg.priceUsdc, cfg.solUsdPrice)
  const unitPlatformFeeLamports = lamportsForUsdcAmount(cfg.platformFeeUsdcPerSpot, cfg.solUsdPrice)
  const unitLamports = unitPartnerLamports + unitPlatformFeeLamports
  const partnerLamports = unitPartnerLamports * BigInt(quantity)
  const platformFeeLamports = unitPlatformFeeLamports * BigInt(quantity)
  const totalLamports = partnerLamports + platformFeeLamports
  return {
    unitPriceUsdc: cfg.priceUsdc,
    platformFeeUsdcPerSpot: cfg.platformFeeUsdcPerSpot,
    solUsdPrice: cfg.solUsdPrice,
    unitPartnerLamports,
    unitPlatformFeeLamports,
    unitLamports,
    partnerLamports,
    platformFeeLamports,
    totalLamports,
    treasuryLamports: partnerLamports,
  }
}

export async function getOwlCenterPresaleServerConfig(
  tenant: OwlCenterPresaleTenantAdmin,
  _solUsdPrice?: number
): Promise<OwlCenterPresaleCampaignConfig> {
  const solUsd = await resolveGen2SolUsdPrice()
  const platformFeeWallet = getOwlCenterPlatformTreasuryWallet()
  if (!platformFeeWallet) {
    throw new Error('Platform fee treasury not configured (OWL_PLATFORM_FEE_TREASURY_WALLET)')
  }
  return tenantToCampaignConfig(tenant, solUsd, platformFeeWallet)
}

export async function getOptionalOwlCenterUnitLamportsQuote(
  tenant: OwlCenterPresaleTenantAdmin
): Promise<{
  unitLamports: bigint
  unitPartnerLamports: bigint
  unitPlatformFeeLamports: bigint
  solUsdPrice: number
  platformFeeUsdcPerSpot: number
} | null> {
  try {
    const solUsd = await resolveGen2SolUsdPrice()
    const feeUsdc = owlCenterPresalePlatformFeeUsdcPerSpot()
    const unitPartnerLamports = lamportsForUsdcAmount(tenant.unit_price_usdc, solUsd)
    const unitPlatformFeeLamports = lamportsForUsdcAmount(feeUsdc, solUsd)
    return {
      unitLamports: unitPartnerLamports + unitPlatformFeeLamports,
      unitPartnerLamports,
      unitPlatformFeeLamports,
      solUsdPrice: solUsd,
      platformFeeUsdcPerSpot: feeUsdc,
    }
  } catch {
    return null
  }
}

/** Quote platform fee alone (for UI labels when full campaign config is unavailable). */
export async function getOptionalOwlCenterPlatformFeeLamportsQuote(): Promise<{
  lamports: bigint
  solUsdPrice: number
  feeUsdc: number
} | null> {
  const feeUsdc = owlCenterPresalePlatformFeeUsdcPerSpot()
  if (feeUsdc <= 0) return { lamports: 0n, solUsdPrice: 0, feeUsdc: 0 }
  const quote = await getOptionalLamportsQuoteForUsdc(feeUsdc)
  if (!quote) return null
  return { lamports: quote.unitLamports, solUsdPrice: quote.solUsdPrice, feeUsdc }
}
