/** OwlSend product limits and defaults (Gembird-aligned Jul 2026). */

/** Platform fee per NFT / token transfer line. */
export const OWL_SEND_DEFAULT_FEE_SOL = 0.001

/** Max NFTs selectable in one send session. */
export const OWL_SEND_MAX_SELECT = 20

/**
 * Max token-scatter recipients (CSV / paste) in one session.
 * Per-approval packing uses {@link OWL_SEND_MAX_PER_TX_TOKEN}; the UI chains
 * approvals (and sign-all windows when the wallet supports it) so airdrops of
 * hundreds of wallets do not require re-uploading truncated CSV chunks.
 */
export const OWL_SEND_MAX_TOKEN_SCATTER = 1000

/**
 * How many token-approval txs to bundle in one wallet sign-all sheet.
 * Large airdrops (e.g. 600+ wallets) still need multiple sheets; this keeps
 * Phantom / Solflare sheets within practical limits.
 */
export const OWL_SEND_TOKEN_SIGN_ALL_WINDOW = 8

/**
 * Max token-scatter lines per Solana tx (hard ceiling).
 * Measured under the 1232-byte packet with token Lighthouse headroom
 * ({@link OWL_SEND_TX_SAFE_BYTES_TOKEN} ≈ 1020):
 * - new dest ATAs (create + transfer): {@link OWL_SEND_MAX_PER_TX_TOKEN_NEW_ATA}
 * - existing dest ATAs (transfer only): {@link OWL_SEND_MAX_PER_TX_TOKEN}
 * Adaptive packing ({@link packOwlSendTokenScatterLines}) fills each tx to the
 * safe budget so airdrops use fewer approvals when many wallets already hold the mint.
 */
export const OWL_SEND_MAX_PER_TX_TOKEN = 12

/** Typical pack width when every recipient needs a new ATA (worst-case airdrop). */
export const OWL_SEND_MAX_PER_TX_TOKEN_NEW_ATA = 7

/** Max token lines (and existing-ATA NFT lines) per wallet approval / transaction. */
export const OWL_SEND_MAX_PER_TX = 5

/**
 * Classic NFT scatter to many wallets: each mint needs a dest ATA + recipient key.
 * 5 × (createATA + leftover-CM revoke + transfer) is 1121 bytes before Jupiter/Phantom
 * inject Lighthouse guards — over Solana's 1232-byte packet, so the approve sheet never opens.
 */
export const OWL_SEND_MAX_PER_TX_NFT_SCATTER = 3

/** Classic NFT send-to-one (shared recipient key) — 4 still leaves wallet-injection headroom. */
export const OWL_SEND_MAX_PER_TX_NFT_ONE = 4

/**
 * How many classic SPL NFTs fit in one approval.
 * Many distinct recipients ⇒ smaller batches (more dest ATAs / account keys).
 */
export function owlSendClassicApprovalSize(uniqueRecipients: number): number {
  if (uniqueRecipients >= 3) return OWL_SEND_MAX_PER_TX_NFT_SCATTER
  return OWL_SEND_MAX_PER_TX_NFT_ONE
}

/**
 * Max cNFT / pNFT / Core assets per wallet approval.
 * Bubblegum proofs are large — one leaf transfer per tx is the reliable default.
 */
export const OWL_SEND_MAX_SPECIAL_PER_TX = 1

/** Pause between chained wallet approvals so mobile wallets can close/reopen cleanly. */
export const OWL_SEND_CHAIN_APPROVAL_GAP_MS = 450

/** Approximate ATA rent when recipient needs a new token account. */
export const OWL_SEND_ATA_RENT_SOL = 0.00203928

/** Approximate base network fee per approval (validators may charge more under load). */
export const OWL_SEND_NETWORK_FEE_SOL_PER_APPROVAL = 0.000005

export type OwlSendMode = 'send_to_one' | 'scatter'

export type OwlSendAssetTab = 'nfts' | 'tokens'
