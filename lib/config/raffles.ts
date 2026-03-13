/**
 * Platform fee (deducted from every ticket sale).
 * - 3% for raffle creators who hold the Owltopia (Owl) NFT.
 * - 6% for non-holders.
 * Applied at purchase time via getPaymentSplit and at settlement.
 */
export const HOLDER_FEE_BPS = 300   // 3%
export const STANDARD_FEE_BPS = 600 // 6%

// Owltopia collection address for holder check. Replace with the real collection when available.
export const OWLTOPIA_COLLECTION_ADDRESS = 'REPLACE_WITH_COLLECTION'

export const BPS_DENOMINATOR = 10_000

