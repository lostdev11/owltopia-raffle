/**
 * When an allowList `route` (proof) tx is prepended to a fee-payer-first `signAll` sheet,
 * wallet-signed results must be split so mint keypairs never sign the route tx and mint
 * indexes stay aligned. Prepending without this offset caused MissingAllowedListProof
 * pre-sim failures and broken asset signing on Core partner WL mints.
 */
export function splitAllowlistRouteFromWalletSigned<T>(
  walletSigned: readonly T[],
  includeRoute: boolean
): { routeSigned: T | null; mintWalletSigned: T[] } {
  if (!includeRoute) {
    return { routeSigned: null, mintWalletSigned: [...walletSigned] }
  }
  if (walletSigned.length === 0) {
    return { routeSigned: null, mintWalletSigned: [] }
  }
  return {
    routeSigned: walletSigned[0]!,
    mintWalletSigned: walletSigned.slice(1),
  }
}
