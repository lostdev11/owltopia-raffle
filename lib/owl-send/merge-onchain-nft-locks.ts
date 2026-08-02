import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * DAS often sets `tokenAccount` to the mint id and can leave stale `ownership.frozen`
 * after Candy Machine thaw. Overlay live SPL/Token-2022 parsed accounts so OwlSend
 * badges and transfers use real ATAs + freeze state.
 */
export function mergeDasNftsWithOnChainLocks(
  dasNfts: WalletNft[],
  onChainNfts: WalletNft[]
): WalletNft[] {
  const byMint = new Map(onChainNfts.map((n) => [n.mint, n]))
  const merged = dasNfts.map((n) => {
    const chain = byMint.get(n.mint)
    if (!chain) return n
    return {
      ...n,
      tokenAccount: chain.tokenAccount || n.tokenAccount,
      amount: chain.amount || n.amount,
      decimals: chain.decimals,
      frozen: chain.frozen ?? n.frozen,
      delegated: chain.delegated ?? n.delegated,
    }
  })

  const seen = new Set(merged.map((n) => n.mint))
  for (const chain of onChainNfts) {
    if (!seen.has(chain.mint)) merged.push(chain)
  }
  return merged
}
