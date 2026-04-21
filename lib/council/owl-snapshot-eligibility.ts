import { getOwlRawBalanceCreditAware } from '@/lib/council/owl-balance-credit-aware'
import { MIN_OWL_TO_CREATE_PROPOSAL } from '@/lib/council/owl-proposal-rules'
import { isOwlEnabled } from '@/lib/tokens'

export type OwlProposalEligibilityResult =
  | {
      ok: true
      eligible: boolean
      balanceRaw: string
      checkedAt: string
      refreshed: boolean
      owlConfigured: true
    }
  | {
      ok: false
      owlConfigured: false
      message: string
    }
  | {
      ok: false
      owlConfigured: true
      code: 'invalid_wallet' | 'rpc_error'
      message: string
    }

/**
 * Returns cached eligibility when snapshot is fresh; otherwise one RPC read + upsert.
 */
export async function getOrRefreshOwlProposalEligibility(
  walletAddress: string
): Promise<OwlProposalEligibilityResult> {
  const w = walletAddress.trim()
  if (!w) {
    return { ok: false, owlConfigured: isOwlEnabled(), code: 'invalid_wallet', message: 'Wallet required.' }
  }

  if (!isOwlEnabled()) {
    return {
      ok: false,
      owlConfigured: false,
      message: 'OWL token is not configured.',
    }
  }

  const bal = await getOwlRawBalanceCreditAware(w)
  if (!bal.ok) {
    if (bal.code === 'invalid_wallet') {
      return { ok: false, owlConfigured: true, code: 'invalid_wallet', message: bal.message }
    }
    if (bal.code === 'owl_disabled') {
      return {
        ok: false,
        owlConfigured: false,
        message: bal.message,
      }
    }
    return { ok: false, owlConfigured: true, code: 'rpc_error', message: bal.message }
  }

  const factor = BigInt(10) ** BigInt(bal.decimals)
  const minRaw = BigInt(MIN_OWL_TO_CREATE_PROPOSAL) * factor
  const eligible = bal.totalRaw >= minRaw

  return {
    ok: true,
    eligible,
    balanceRaw: bal.totalRaw.toString(),
    checkedAt: bal.checkedAt,
    refreshed: bal.source === 'rpc',
    owlConfigured: true,
  }
}
