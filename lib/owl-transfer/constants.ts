/** Owl Transfer product limits and defaults (Gembird-aligned Jul 2026). */

/** Platform fee per NFT / token transfer line. */
export const OWL_TRANSFER_DEFAULT_FEE_SOL = 0.001

/** Max NFTs selectable in one send session. */
export const OWL_TRANSFER_MAX_SELECT = 20

/** Max NFTs (and Scatter wallets) per wallet approval / transaction. */
export const OWL_TRANSFER_MAX_PER_TX = 5

/** Approximate ATA rent when recipient needs a new token account. */
export const OWL_TRANSFER_ATA_RENT_SOL = 0.00203928

/** Approximate base network fee per approval (validators may charge more under load). */
export const OWL_TRANSFER_NETWORK_FEE_SOL_PER_APPROVAL = 0.000005

export type OwlTransferMode = 'send_to_one' | 'scatter'

export type OwlTransferAssetTab = 'nfts' | 'tokens'
