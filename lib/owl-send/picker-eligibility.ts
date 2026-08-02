import type { WalletNft } from '@/lib/solana/wallet-tokens'

/**
 * Informational picker badge only — OwlSend does not soft-block on frozen/delegated.
 * The token program rejects non-transferable accounts at send time.
 */
export function owlSendNftLockLabel(nft: WalletNft): string | null {
  if (nft.frozen === true) return 'Marked frozen'
  return null
}

/** Badge when this mint failed a send (highlighted in the picker). */
export function owlSendNftProblemLabel(
  nft: WalletNft,
  problemMints: Set<string> | undefined
): string | null {
  if (problemMints?.has(nft.mint)) return 'Can’t send · see retry'
  return owlSendNftLockLabel(nft)
}
