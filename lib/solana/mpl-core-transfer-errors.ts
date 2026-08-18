/**
 * Metaplex Core program logs for transfer failures (see @metaplex-foundation/mpl-core generated errors).
 */

import { resolvePublicSolanaRpcUrl } from '@/lib/solana-rpc-url'

/** Core error 0x1a — plugins / oracle must approve before Transfer succeeds. */
export function isMplCoreNoApprovalsError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('0x1a') ||
    m.includes('neither the asset or any plugins have approved') ||
    m.includes('noapprovals')
  )
}

/**
 * fetchAsset / deserialize failed because the address is not an Mpl Core asset account.
 * Common when escrow fallbacks try Core after wallet-RPC missed an SPL/Token Metadata NFT
 * (SDK: AssetAccountData + EnumDiscriminatorOutOfRangeError).
 */
export function isMplCoreWrongAccountTypeError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('assetaccountdata') ||
    m.includes('not of the expected type') ||
    m.includes('enumdiscriminatoroutofrange') ||
    (m.includes('enum discriminator out of range') && m.includes('expected a number between'))
  )
}

/**
 * Strip noisy Kinobi/SDK stack text from escrow fallback failures for UI copy.
 */
export function sanitizeEscrowTransferFallbackError(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return trimmed
  if (isMplCoreWrongAccountTypeError(trimmed)) {
    return (
      'This NFT is not a Metaplex Core asset (in-app Core transfer does not apply). ' +
      'If it is a normal SPL / Token Metadata NFT, refresh and retry, or send it manually to escrow and paste the signature.'
    )
  }
  // Keep the first meaningful line; drop "Source: SDK / Caused By:" dumps when long.
  const firstLine = trimmed.split('\n').map((l) => l.trim()).find(Boolean) ?? trimmed
  if (firstLine.length <= 280) return firstLine
  return `${firstLine.slice(0, 277)}…`
}

/** Solscan “account” view for an MPL Core asset id (same address you use in wallets). */
export function solscanMplCoreAssetUrl(assetAddress: string): string {
  const q = /devnet/i.test(resolvePublicSolanaRpcUrl()) ? '?cluster=devnet' : ''
  return `https://solscan.io/account/${encodeURIComponent(assetAddress.trim())}${q}`
}

/**
 * User-facing explanation: NoApprovals is permanent until the asset/collection allows the transfer.
 * `fullAssetId` should be the full on-chain address (for the explorer link), not the shortened label.
 */
export function mplCoreNoApprovalsEscrowMessage(
  mintShort: string,
  options?: { fullAssetId?: string }
): string {
  const explorer =
    options?.fullAssetId && options.fullAssetId.trim().length > 0
      ? ` On-chain (plugins / authorities): ${solscanMplCoreAssetUrl(options.fullAssetId.trim())}`
      : ''
  return (
    `This Metaplex Core NFT is blocked from transferring until its plugins approve the move (NoApprovals, error 0x1a). ` +
    `That is enforced by the collection on-chain — Owltopia cannot override it, and tapping Deposit again will not change it. ` +
    `Ask the collection (e.g. Discord) how to get transfer approval for marketplaces or custody wallets, or use a different prize NFT. ` +
    `Sending from your wallet to escrow hits the same rule.${explorer} Asset: ${mintShort}.`
  )
}
