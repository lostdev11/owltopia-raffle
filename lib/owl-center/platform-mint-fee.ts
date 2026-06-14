/** Flat Owltopia platform fee charged per NFT mint (USDC), even when creator mint price is free. */
export function owlCenterPlatformMintFeeUsdc(): number {
  const raw = process.env.OWL_CENTER_PLATFORM_MINT_FEE_USDC?.trim()
  if (!raw) return 1
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

const USDC_DECIMALS = 6

export function isOwlCenterPlatformMintFeeEnabled(): boolean {
  return owlCenterPlatformMintFeeUsdc() > 0
}

/** Raw USDC atoms (6 decimals) for on-chain transfer instructions. */
export function owlCenterPlatformMintFeeUsdcRaw(): bigint {
  return BigInt(Math.round(owlCenterPlatformMintFeeUsdc() * 10 ** USDC_DECIMALS))
}

export function formatOwlCenterPlatformMintFeeLabel(): string {
  const fee = owlCenterPlatformMintFeeUsdc()
  if (fee <= 0) return 'No platform mint fee'
  return `$${fee.toFixed(fee % 1 === 0 ? 0 : 2)} USDC platform fee per mint`
}

export function formatCreatorMintPriceLabel(price: number, currency: 'SOL' | 'USDC'): string {
  if (!Number.isFinite(price) || price <= 0) return 'Free'
  return `${price} ${currency}`
}

export function formatTotalMintCostHint(creatorPrice: number, currency: 'SOL' | 'USDC'): string {
  const platformFee = owlCenterPlatformMintFeeUsdc()
  const creator = formatCreatorMintPriceLabel(creatorPrice, currency)
  if (platformFee <= 0) return creator
  if (creatorPrice <= 0) return `Free mint + ${formatOwlCenterPlatformMintFeeLabel()}`
  return `${creator} + ${formatOwlCenterPlatformMintFeeLabel()}`
}
