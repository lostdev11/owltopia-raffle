/** OwlSwap product limits and defaults (Phase 1). */

/** Platform fee per completed swap (taker pays on accept). */
export const OWL_SWAP_DEFAULT_FEE_SOL = 0.02

/** Max classic SPL NFTs selectable per side. */
export const OWL_SWAP_MAX_NFTS_PER_SIDE = 5

/** How long an open offer stays claimable before expiry. */
export const OWL_SWAP_OFFER_TTL_HOURS = 72

/** Max concurrent draft/open offers per maker wallet. */
export const OWL_SWAP_MAX_OPEN_OFFERS_PER_WALLET = 3

/** Modest CU headroom for multi-NFT settle / reclaim. */
export const OWL_SWAP_COMPUTE_UNIT_LIMIT = 400_000

export const OWL_SWAP_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 50_000

/** Pause between chained wallet approvals on mobile. */
export const OWL_SWAP_CHAIN_APPROVAL_GAP_MS = 450
