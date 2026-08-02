/**
 * Map a send/preflight error into short Retry-list copy.
 * Do not always blame nesting — Gen2 leftovers are often mint-freeze or special-path NFTs.
 */
export function owlSendRetryHint(error: string | null | undefined): string {
  const e = (error ?? '').trim()
  if (/frozen|unnest|thaw|mint-locked|mint lock|nested/i.test(e)) {
    return 'Frozen on-chain (Owltopia nest lock or Gen2 Candy Machine mint freeze) — unnest/thaw, then retry. A leftover stake delegate after thaw alone does not block sends.'
  }
  if (/core|compressed|pnft|transferable spl|could not find|single-nft|alone|multi-send/i.test(e)) {
    return 'This NFT cannot ride in a classic SPL multi-send — deselect it and send it alone (batch of 1).'
  }
  if (/too large/i.test(e)) {
    return 'Batch too large for one transaction — send fewer NFTs, or send to wallets that already hold the collection.'
  }
  if (/reject|cancelled|canceled|user denied|approval/i.test(e)) {
    return 'Wallet rejected or cancelled — open the wallet app and retry the approval.'
  }
  if (e) return e
  return 'Fix the error above, then retry these NFTs.'
}
