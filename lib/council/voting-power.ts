import type { OwlProposalRow } from '@/lib/db/owl-council'
import { getOwlRawBalanceCreditAware } from '@/lib/council/owl-balance-credit-aware'
import { owlRawToDecimalString } from '@/lib/council/owl-amount-format'
import { isCouncilOwlEscrowVotingEnabled } from '@/lib/council/council-owl-escrow-keypair'
import { getOwlCouncilEscrowBalanceRaw } from '@/lib/db/owl-council-escrow'
import { getTokenInfo } from '@/lib/tokens'

/**
 * Vote weight: when `COUNCIL_OWL_ESCROW_SECRET_KEY` is set, uses OWL sitting in council escrow for this wallet;
 * otherwise OWL balance (snapshot-aware credit path).
 */
export async function resolveVotingPowerForOwlVote(
  wallet: string,
  _proposal: OwlProposalRow
): Promise<
  | { ok: true; weightDecimal: string; weightApprox: number }
  | { ok: false; code: 'no_owl' | 'owl_disabled' | 'invalid_wallet' | 'rpc_error'; message: string }
> {
  const w = wallet.trim()

  if (isCouncilOwlEscrowVotingEnabled()) {
    const owl = getTokenInfo('OWL')
    if (!owl.mintAddress) {
      return { ok: false, code: 'owl_disabled', message: 'OWL mint address missing.' }
    }
    const raw = await getOwlCouncilEscrowBalanceRaw(w)
    if (raw <= 0n) {
      return {
        ok: false,
        code: 'no_owl',
        message:
          'No OWL in Owl Council escrow for this wallet. Use the Council escrow panel to deposit OWL, then vote. Your voting weight equals the OWL you keep in escrow.',
      }
    }
    const weightDecimal = owlRawToDecimalString(raw, owl.decimals)
    const weightApprox = Number(weightDecimal)
    if (!Number.isFinite(weightApprox)) {
      return { ok: false, code: 'rpc_error', message: 'Could not compute voting weight.' }
    }
    return { ok: true, weightDecimal, weightApprox }
  }

  const measured = await getOwlRawBalanceCreditAware(w)
  if (!measured.ok) {
    if (measured.code === 'invalid_wallet') {
      return { ok: false, code: 'invalid_wallet', message: measured.message }
    }
    if (measured.code === 'owl_disabled') {
      return { ok: false, code: 'owl_disabled', message: measured.message }
    }
    return { ok: false, code: 'rpc_error', message: measured.message }
  }

  if (measured.totalRaw <= 0n) {
    return {
      ok: false,
      code: 'no_owl',
      message: 'You need a positive OWL balance to vote.',
    }
  }

  const weightDecimal = owlRawToDecimalString(measured.totalRaw, measured.decimals)
  const weightApprox = Number(weightDecimal)
  if (!Number.isFinite(weightApprox)) {
    return { ok: false, code: 'rpc_error', message: 'Could not compute voting weight.' }
  }

  return { ok: true, weightDecimal, weightApprox }
}
