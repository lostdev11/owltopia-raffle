export const OWL_CENTER_PRESALE_DEFAULT_MAX_SPOTS_PER_PURCHASE = 5
export const OWL_CENTER_PRESALE_DEFAULT_MAX_CREDITS_PER_WALLET = 20
export const OWL_CENTER_PRESALE_DEFAULT_SUPPLY = 100
export const OWL_CENTER_PRESALE_DEFAULT_PRICE_USDC = 20

/** Hard limits for partner self-serve + admin forms. */
export const OWL_CENTER_PRESALE_LIMITS = {
  supply: { min: 1, max: 100_000 },
  priceUsdc: { min: 1, max: 10_000 },
  maxSpotsPerPurchase: { min: 1, max: 100 },
  maxCreditsPerWallet: { min: 1, max: 50 },
} as const

/** Quick-select presets (custom values still allowed within LIMITS). */
export const OWL_CENTER_PRESALE_PRESETS = {
  supply: [100, 250, 500, 1000] as const,
  priceUsdc: [5, 10, 20, 50, 100] as const,
  maxSpotsPerPurchase: [1, 3, 5, 10] as const,
  maxCreditsPerWallet: [5, 10, 20] as const,
} as const

/** Owltopia platform fee per purchased spot ($ USDC-equivalent in SOL). Env override shared with mint fee. */
export function owlCenterPresalePlatformFeeUsdcPerSpot(): number {
  const raw = process.env.OWL_CENTER_PLATFORM_MINT_FEE_USDC?.trim()
  if (!raw) return 1
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

export const OWL_CENTER_PRESALE_GIFT_DEFAULT_MAX = 50
export const OWL_CENTER_PRESALE_GIFT_ABSOLUTE_CAP = 200
export const OWL_CENTER_PRESALE_GIFT_SQL_HARD_CAP = 500

export function getOwlCenterPresaleMaxGiftQuantity(): number {
  const raw = process.env.OWL_CENTER_PRESALE_ADMIN_MAX_GIFT_QTY?.trim()
  if (!raw) return OWL_CENTER_PRESALE_GIFT_DEFAULT_MAX
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return OWL_CENTER_PRESALE_GIFT_DEFAULT_MAX
  return Math.min(OWL_CENTER_PRESALE_GIFT_ABSOLUTE_CAP, Math.floor(n))
}

export const OWL_CENTER_PRESALE_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const OWL_CENTER_PRESALE_DEFAULT_THEME = {
  primary: '#00FF9C',
  accent: '#00E58B',
  background: '#0B0F12',
  surface: '#151D24',
  muted: '#A9CBB9',
} as const

export type OwlCenterPresaleApprovalStatus = 'pending' | 'approved' | 'rejected'
