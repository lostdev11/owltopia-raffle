import {
  isOwlSendWalletExtensionError,
} from '@/lib/owl-send/wallet-send-errors'

/**
 * Map a send/preflight error into short Retry-list copy.
 * Do not always blame nesting — Gen2 leftovers are often mint-freeze or special-path NFTs.
 */
export function owlSendRetryHint(error: string | null | undefined): string {
  const e = (error ?? '').trim()
  if (isOwlSendWalletExtensionError(e)) {
    return 'Open Phantom, unlock it, refresh this page, reconnect your wallet, then retry — the approve popup cannot open while the extension is unreachable.'
  }
  if (/remove or unnest|the others are fine/i.test(e)) {
    return 'Deselect nested/frozen NFTs (or unnest on Nesting), then retry the rest — no thaw needed for sendable Gen2s.'
  }
  if (/frozen|Account is frozen|0x11\b|unnest|thaw|mint-locked|mint lock|nested/i.test(e)) {
    return 'On-chain transfer rejected as frozen. Tap Thaw locks if this is an orphaned Gen2 nest lock, or unnest on Nesting if it is still nested.'
  }
  if (/core|compressed|pnft|transferable spl|could not find|single-nft|alone|separate send|classic spl|token metadata/i.test(e)) {
    return 'Deselect cNFT / Core / pNFT from this batch and send them alone. Gen2s should stay in the classic multi-send (one approval).'
  }
  if (/too large/i.test(e)) {
    return 'Batch too large for one transaction — send fewer NFTs, or send to wallets that already hold the collection.'
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
