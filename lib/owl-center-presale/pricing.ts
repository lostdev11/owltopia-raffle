import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

import { resolveGen2SolUsdPrice } from '@/lib/gen2-presale/sol-usd-price'
import type { OwlCenterPresaleTenantAdmin } from '@/lib/owl-center-presale/types'

export type OwlCenterPresaleCampaignConfig = {
  priceUsdc: number
  presaleSupply: number
  solUsdPrice: number
  treasuryWallet: PublicKey
  maxSpotsPerPurchase: number
  maxCreditsPerWallet: number
}

export type OwlCenterPriceBreakdown = {
  unitPriceUsdc: number
  solUsdPrice: number
  unitLamports: bigint
  totalLamports: bigint
  treasuryLamports: bigint
}

export function tenantToCampaignConfig(
  tenant: OwlCenterPresaleTenantAdmin,
  solUsdPrice: number
): OwlCenterPresaleCampaignConfig {
  return {
    priceUsdc: tenant.unit_price_usdc,
    presaleSupply: tenant.presale_supply,
    solUsdPrice,
    treasuryWallet: new PublicKey(tenant.treasury_wallet),
    maxSpotsPerPurchase: tenant.max_spots_per_purchase,
    maxCreditsPerWallet: tenant.max_credits_per_wallet,
  }
}

export function lamportsPerSpot(cfg: Pick<OwlCenterPresaleCampaignConfig, 'priceUsdc' | 'solUsdPrice'>): bigint {
  const unitSol = cfg.priceUsdc / cfg.solUsdPrice
  return BigInt(Math.round(unitSol * LAMPORTS_PER_SOL))
}

export function computeOwlCenterPurchaseLamports(
  cfg: Pick<OwlCenterPresaleCampaignConfig, 'priceUsdc' | 'solUsdPrice'>,
  quantity: number
): OwlCenterPriceBreakdown {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error('quantity must be a positive integer')
  }
  const unit = lamportsPerSpot(cfg)
  const totalLamports = unit * BigInt(quantity)
  return {
    unitPriceUsdc: cfg.priceUsdc,
    solUsdPrice: cfg.solUsdPrice,
    unitLamports: unit,
    totalLamports,
    treasuryLamports: totalLamports,
  }
}

export async function getOwlCenterPresaleServerConfig(
  tenant: OwlCenterPresaleTenantAdmin,
  _solUsdPrice?: number
): Promise<OwlCenterPresaleCampaignConfig> {
  // Always use live server oracle — never a client-supplied SOL/USD for amount checks.
  const solUsd = await resolveGen2SolUsdPrice()
  return tenantToCampaignConfig(tenant, solUsd)
}

export async function getOptionalOwlCenterUnitLamportsQuote(
  tenant: OwlCenterPresaleTenantAdmin
): Promise<{ unitLamports: bigint; solUsdPrice: number } | null> {
  try {
    const solUsd = await resolveGen2SolUsdPrice()
    const unitLamports = lamportsPerSpot({ priceUsdc: tenant.unit_price_usdc, solUsdPrice: solUsd })
    return { unitLamports, solUsdPrice: solUsd }
  } catch {
    return null
  }
}
