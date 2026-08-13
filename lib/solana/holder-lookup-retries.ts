/**
 * Caps holder-resolution RPC churn (getParsedTokenAccountsByOwner paths in wallet-tokens).
 * NFT loops: at most this many getNftHolderInWallet calls.
 * Partner/fungible + early NFT retry: one initial fetch, then up to (max - 1) delayed retries.
 */
export const HOLDER_LOOKUP_MAX_ATTEMPTS = 8

/**
 * Create-raffle hot path: fewer retries / shorter delay so the wallet approve prompt
 * opens sooner when the picker already selected the NFT.
 */
export const CREATE_FLOW_HOLDER_LOOKUP_MAX_ATTEMPTS = 3
export const CREATE_FLOW_HOLDER_LOOKUP_RETRY_MS = 280
