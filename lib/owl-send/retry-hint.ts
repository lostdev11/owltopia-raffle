import {
  isOwlSendWalletExtensionError,
} from '@/lib/owl-send/wallet-send-errors'
import { isOwlSendCoreOwnerFreezeError } from '@/lib/owl-send/mpl-core-owner-freeze'

/**
 * Map a send/preflight error into short Retry-list copy.
 * Do not always blame nesting — Gen2 leftovers are often mint-freeze or special-path NFTs.
 */
export function owlSendRetryHint(error: string | null | undefined): string {
  const e = (error ?? '').trim()
  if (isOwlSendWalletExtensionError(e)) {
    return 'Open your wallet (Jupiter / Phantom / Solflare), unlock it, refresh this page, reconnect, then retry — the approve popup cannot open while the wallet is unreachable. On Jupiter Mobile use the in-app globe browser.'
  }
  if (isOwlSendCoreOwnerFreezeError(e)) {
    return 'Force-released Core NFTs stay Owner-frozen until you thaw. Tap Thaw locks here (or Nesting → Thaw leftover nest locks), approve in your wallet, then Retry.'
  }
  if (/remove or unnest|the others are fine/i.test(e)) {
    return 'Deselect nested/frozen NFTs (or unnest on Nesting), then retry the rest — no thaw needed for sendable Gen2s.'
  }
  if (/frozen|Account is frozen|0x11\b|unnest|thaw|mint-locked|mint lock|nested|freezedelegate/i.test(e)) {
    return 'On-chain transfer rejected as frozen. Tap Thaw locks for orphaned nest locks (Core Owner freeze or Gen2), or unnest on Nesting if still nested.'
  }
  if (/core|compressed|pnft|transferable spl|could not find|single-nft|alone|separate send|classic spl|token metadata|incorrect program id|incorrectprogramid|bubblegum/i.test(e)) {
    return 'Deselect cNFT / Core / pNFT from this batch and send them alone. Gen2s should stay in the classic multi-send (one approval).'
  }
  if (/too large|does not fit|packet|encoding overruns|max account/i.test(e)) {
    return 'This approval was too large for one Solana transaction (common when sending Gen2s to new wallets). OwlSend now uses smaller batches — tap Retry.'
  }
  if (/timed out|timeout/i.test(e)) {
    return 'Wallet approval timed out — open the wallet extension/app (check for a hidden popup), then Cancel and Retry.'
  }
  if (/reject|cancelled|canceled|user denied|approval/i.test(e)) {
    return 'Wallet rejected or cancelled — open the wallet app and retry the approval.'
  }
  if (e) return e
  return 'Fix the error above, then retry these NFTs.'
}
