/**
 * Minimum OWL (SPL) balance required to create an Owl Council proposal (anti-spam / skin in the game).
 * Shares the same snapshot TTL as eligibility/voting so RPC is skipped when `owl_wallet_owl_snapshots` is fresh.
 */

import { getOwlRawBalanceCreditAware } from '@/lib/council/owl-balance-credit-aware'
import { MIN_OWL_TO_CREATE_PROPOSAL } from '@/lib/council/owl-proposal-rules'
import { isOwlEnabled } from '@/lib/tokens'

export { MIN_OWL_TO_CREATE_PROPOSAL }

export async function assertWalletHasMinOwlForCouncilProposal(
  walletAddress: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const trimmed = walletAddress.trim()
  if (!trimmed) {
    return { ok: false, error: 'Wallet address required.', status: 400 }
  }

  if (!isOwlEnabled()) {
    return {
      ok: false,
      error:
        'OWL token is not configured (NEXT_PUBLIC_OWL_MINT_ADDRESS). Cannot verify the 10 OWL requirement.',
      status: 503,
    }
  }

  const measured = await getOwlRawBalanceCreditAware(trimmed)
  if (!measured.ok) {
    if (measured.code === 'invalid_wallet') {
      return { ok: false, error: measured.message, status: 400 }
    }
    if (measured.code === 'owl_disabled') {
      return { ok: false, error: measured.message, status: 503 }
    }
    return {
      ok: false,
      error: 'Could not verify OWL balance. Try again or check RPC configuration.',
      status: 503,
    }
  }

  const factor = BigInt(10) ** BigInt(measured.decimals)
  const minRaw = BigInt(MIN_OWL_TO_CREATE_PROPOSAL) * factor

  if (measured.totalRaw < minRaw) {
    return {
      ok: false,
      error: `You need at least ${MIN_OWL_TO_CREATE_PROPOSAL} OWL in this wallet to create a proposal.`,
      status: 403,
    }
  }

  return { ok: true }
}
