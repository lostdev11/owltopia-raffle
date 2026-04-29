/**
 * Caps holder-resolution RPC churn (getParsedTokenAccountsByOwner paths in wallet-tokens).
 * NFT loops: at most this many getNftHolderInWallet calls.
 * Partner/fungible + early NFT retry: one initial fetch, then up to (max - 1) delayed retries.
 */
export const HOLDER_LOOKUP_MAX_ATTEMPTS = 3
