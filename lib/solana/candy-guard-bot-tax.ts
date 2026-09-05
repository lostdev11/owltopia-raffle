/**
 * Candy Guard `botTax` turns many guard failures into a "successful" transaction:
 * `meta.err` stays null, the wallet pays bot tax (+ any preceding platform fee), and no NFT mints.
 * RPC preflight / simulate with only `err` checks therefore miss these doomed mints.
 */

/** Substrings that appear in program logs when Candy Guard bot-taxed instead of minting. */
export const CANDY_GUARD_BOT_TAX_LOG_MARKERS = [
  // Specific guard errors first — otherwise the generic "Botting is taxed" line wins.
  'AllowedMintLimitReached',
  'AddressNotFound',
  'MissingAllowedListProof',
  'AllowedListProofMismatch',
  'NotEnoughSOL',
  'NotEnoughTokens',
  'Gatekeeper',
  'GuardNotEnabled',
  'IncorrectMintAuthority',
  'ExceededLength',
  'MaximumRedeemedAmount',
  'RequiredCollection',
  'Candy Guard Botting is taxed',
] as const

/**
 * Returns a short user-facing reason when logs show a bot-tax / guard rejection,
 * or null when the logs look like a normal mint (or are empty).
 */
export function candyGuardSimulationLooksLikeBotTax(
  logs: readonly string[] | null | undefined
): string | null {
  if (!logs?.length) return null
  const joined = logs.join('\n')
  for (const marker of CANDY_GUARD_BOT_TAX_LOG_MARKERS) {
    if (!joined.includes(marker)) continue
    if (marker === 'AllowedMintLimitReached') {
      return 'Wallet mint limit already reached on-chain — minting again would only charge fees (no NFT).'
    }
    if (marker === 'Candy Guard Botting is taxed') {
      return 'Mint would be rejected by the Candy Guard (bot tax only — no NFT). Refresh eligibility and try again if you still have spots.'
    }
    return `Mint would be rejected by the Candy Guard (${marker}) — you would only pay fees, not receive an NFT.`
  }
  return null
}
