/**
 * Platform raffle treasury — same wallet used for ticket fee splits, OWL community-giveaway boosts, etc.
 * Server: set RAFFLE_RECIPIENT_WALLET. Client builds need NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET with the same address.
 */
export function getRaffleTreasuryWalletAddress(): string | null {
  const w =
    process.env.RAFFLE_RECIPIENT_WALLET?.trim() ||
    process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET?.trim() ||
    ''
  return w || null
}
