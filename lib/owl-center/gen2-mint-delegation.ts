import { getDelegationByMintWallet, getDelegationBySourceWallet } from '@/lib/db/gen2-gen1-delegations'
import { getOwltopiaGen1Snapshot, type OwltopiaGen1Snapshot } from '@/lib/owl-center/owltopia-gen1'

/**
 * Gen1 holder snapshot resolved through the admin "switch wallet for mint" delegations
 * (migration 170). Used by the AIRDROP eligibility + mint-check paths so the live
 * holder check honors a wallet switch.
 *
 * - Connected wallet is a delegation `mint_wallet`: credit it with the live Gen1 count
 *   of the mapped `source_wallet` (`delegated_from`).
 * - Connected wallet is a delegated `source_wallet`: it has handed its entitlement to
 *   another wallet, so block it from minting (`delegated_away_to`).
 * - Otherwise: the unmodified on-chain holder check for the connected wallet.
 *
 * The raw `getOwltopiaGen1Snapshot` is intentionally left untouched so cluster hints
 * (lib/owl-center/gen2-mint-check-cluster.ts) keep reporting true on-chain holdings.
 */
export type ResolvedGen1Snapshot = OwltopiaGen1Snapshot & {
  /** Set when the connected wallet mints on behalf of this source wallet. */
  delegated_from: string | null
  /** Set when the connected (source) wallet has delegated its mint to this wallet. */
  delegated_away_to: string | null
}

/**
 * Which wallet's on-chain Gen1 holdings the connected wallet should be credited with.
 * A delegated source wallet (`delegated_away`) is always blocked, even if it is also a
 * mint target somewhere else. Pure — exported for unit testing.
 */
export type Gen1DelegationDecision =
  | { kind: 'delegated_away'; mint_wallet: string }
  | { kind: 'on_behalf'; source_wallet: string }
  | { kind: 'self' }

export function decideGen1Delegation(
  asMint: { source_wallet: string } | null,
  asSource: { mint_wallet: string } | null
): Gen1DelegationDecision {
  // Source-first: a wallet that handed its entitlement away never mints, period.
  if (asSource) return { kind: 'delegated_away', mint_wallet: asSource.mint_wallet }
  if (asMint) return { kind: 'on_behalf', source_wallet: asMint.source_wallet }
  return { kind: 'self' }
}

export async function resolveGen1SnapshotForMint(connectedWallet: string): Promise<ResolvedGen1Snapshot> {
  const [asMint, asSource] = await Promise.all([
    getDelegationByMintWallet(connectedWallet),
    getDelegationBySourceWallet(connectedWallet),
  ])

  const decision = decideGen1Delegation(asMint, asSource)

  // Connected wallet has delegated its Gen1 entitlement away — block it from minting.
  if (decision.kind === 'delegated_away') {
    return {
      is_holder: false,
      gen1_nft_count: 0,
      collection_configured: true,
      holder_check_available: true,
      delegated_from: null,
      delegated_away_to: decision.mint_wallet,
    }
  }

  // Connected wallet mints on behalf of a source wallet — credit the source's live count.
  if (decision.kind === 'on_behalf') {
    const snapshot = await getOwltopiaGen1Snapshot(decision.source_wallet)
    return { ...snapshot, delegated_from: decision.source_wallet, delegated_away_to: null }
  }

  const snapshot = await getOwltopiaGen1Snapshot(connectedWallet)
  return { ...snapshot, delegated_from: null, delegated_away_to: null }
}
