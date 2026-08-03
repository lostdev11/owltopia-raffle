import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Clear DAS `ownership.frozen` when it was not confirmed by a live SPL parse.
 * Leftover Candy Machine delegates must not look nested/frozen in OwlSend.
 */
export function clearUnconfirmedDasFrozen(nfts: WalletNft[]): WalletNft[] {
  return nfts.map((n) => (n.frozen === true ? { ...n, frozen: false } : n))
}

/**
 * DAS often sets `tokenAccount` to the mint id and can leave stale `ownership.frozen`
 * after Candy Machine thaw. Overlay live SPL/Token-2022 parsed accounts so OwlSend
 * badges and transfers use real ATAs + freeze state.
 *
 * Freeze/delegate flags come from chain when the mint is in the overlay. Mints missing
 * from a successful overlay drop DAS frozen (confirm-or-unknown — never false frozen).
 */
export function mergeDasNftsWithOnChainLocks(
  dasNfts: WalletNft[],
  onChainNfts: WalletNft[]
): WalletNft[] {
  const byMint = new Map(onChainNfts.map((n) => [n.mint, n]))
  const overlayPresent = onChainNfts.length > 0
  const merged = dasNfts.map((n) => {
    const chain = byMint.get(n.mint)
    if (!chain) {
      // Overlay ran but this mint wasn't found — do not keep DAS stale frozen.
      if (overlayPresent && n.frozen === true) {
        return { ...n, frozen: false }
      }
      return n
    }
    return {
      ...n,
      tokenAccount: chain.tokenAccount || n.tokenAccount,
      amount: chain.amount || n.amount,
      decimals: chain.decimals,
      // Only mark frozen when the live token account state is frozen.
      frozen: chain.frozen === true,
      delegated: chain.delegated === true,
    }
  })

  const seen = new Set(merged.map((n) => n.mint))
  for (const chain of onChainNfts) {
    if (!seen.has(chain.mint)) merged.push(chain)
  }
  return merged
}
