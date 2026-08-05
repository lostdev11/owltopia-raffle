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
 * after Candy Machine thaw. Overlay live SPL/Token-2022 accounts so OwlSend badges and
 * transfers use real ATAs + freeze state.
 *
 * Prefer a **complete** derived-ATA overlay (one row per DAS mint). Truncated owner-scans
 * must not clear freeze for mints they simply never returned.
 *
 * Freeze/delegate flags come from chain when the mint is in the overlay. Mints missing
 * from a successful *complete* overlay drop DAS frozen (confirm-or-unknown).
 */
export function mergeDasNftsWithOnChainLocks(
  dasNfts: WalletNft[],
  onChainNfts: WalletNft[],
  options?: {
    /**
     * When true (default if overlay covers ≥90% of DAS mints, or caller opts in), missing
     * overlay rows clear DAS frozen. When false, keep DAS frozen for mints the overlay missed
     * (truncated getParsedTokenAccountsByOwner).
     */
    treatMissingAsThawed?: boolean
  }
): WalletNft[] {
  const byMint = new Map(onChainNfts.map((n) => [n.mint, n]))
  const overlayPresent = onChainNfts.length > 0
  const coverage =
    dasNfts.length > 0 ? onChainNfts.filter((n) => dasNfts.some((d) => d.mint === n.mint)).length / dasNfts.length : 0
  const treatMissingAsThawed =
    options?.treatMissingAsThawed ?? (overlayPresent && coverage >= 0.9)

  const merged = dasNfts.map((n) => {
    const chain = byMint.get(n.mint)
    if (!chain) {
      if (treatMissingAsThawed && n.frozen === true) {
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
      // Leftover CM delegates stay delegated=true on-chain but are NOT nested/staked.
      delegated: chain.delegated === true,
    }
  })

  const seen = new Set(merged.map((n) => n.mint))
  for (const chain of onChainNfts) {
    if (!seen.has(chain.mint)) merged.push(chain)
  }
  return merged
}
