/**
 * Metaplex Core program logs for transfer failures (see @metaplex-foundation/mpl-core generated errors).
 */

/** Core error 0x1a — plugins / oracle must approve before Transfer succeeds. */
export function isMplCoreNoApprovalsError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('0x1a') ||
    m.includes('neither the asset or any plugins have approved') ||
    m.includes('noapprovals')
  )
}

export function mplCoreNoApprovalsEscrowMessage(mintShort: string): string {
  return (
    `This NFT is Metaplex Core with plugins that did not approve the transfer (NoApprovals, error 0x1a). ` +
    `The collection sets that on-chain — Owltopia cannot bypass it. ` +
    `Ask the project how to approve transfers (oracle, delegate, or their app). ` +
    `Sending to the escrow address in your wallet uses the same rule and will fail until transfers are allowed. ` +
    `You may need a different prize NFT. (Mint: ${mintShort})`
  )
}
