import type { OwlProposalRow } from '@/lib/db/owl-council'
import { getOwlRawBalanceCreditAware } from '@/lib/council/owl-balance-credit-aware'
import { owlRawToDecimalString } from '@/lib/council/owl-amount-format'
import { isCouncilOwlEscrowVotingEnabled } from '@/lib/council/council-owl-escrow-keypair'
import { getOwlCouncilEscrowBalanceRaw } from '@/lib/db/owl-council-escrow'
import { getTokenInfo } from '@/lib/tokens'

import {
  isPastCouncilLegacyEscrowDepositCutoff,
} from '@/lib/council/council-stake-migration'
import {
  councilNestingVoteWeightIsActive,
  formatNestingStakeWeightDecimal,
  getOwlCouncilNestingStakedRawSum,
} from '@/lib/council/council-nesting-stake'

export type CouncilVoteWeightMeta = {
  /** Legacy council SPL escrow ledger. */
  usedCouncilEscrow: boolean
  /** OWL staked in Owl Council governance nesting pool (post–deposit-cutoff). */
  usedCouncilNesting: boolean
}

/**
 * Vote weight:
 * - After `OWL_COUNCIL_LEGACY_ESCROW_DEPOSIT_CUTOFF_AT`: OWL in the **Owl Council nesting pool** only (not legacy escrow).
 * - Before cutoff, when `COUNCIL_OWL_ESCROW_SECRET_KEY` is set: OWL in council escrow.
 * - Otherwise: OWL wallet balance (credit-aware path).
 */
export async function resolveVotingPowerForOwlVote(
  wallet: string,
  _proposal: OwlProposalRow
): Promise<
  | ({
      ok: true
      weightDecimal: string
      weightApprox: number
    } & CouncilVoteWeightMeta)
  | { ok: false; code: 'no_owl' | 'owl_disabled' | 'invalid_wallet' | 'rpc_error'; message: string }
> {
  const w = wallet.trim()

  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) {
    return { ok: false, code: 'owl_disabled', message: 'OWL mint address missing.' }
  }

  if (isPastCouncilLegacyEscrowDepositCutoff()) {
    const nestReady = await councilNestingVoteWeightIsActive()
    if (!nestReady) {
      return {
        ok: false,
        code: 'owl_disabled',
        message:
          'Council voting is using the Nesting pool, but it is not configured yet. Set OWL mint on the “Owl Council — OWL governance” pool in admin and activate the pool, or adjust OWL_COUNCIL_LEGACY_ESCROW_DEPOSIT_CUTOFF_AT.',
      }
    }

    const raw = await getOwlCouncilNestingStakedRawSum(w)
    if (raw <= 0n) {
      return {
        ok: false,
        code: 'no_owl',
        message:
          'No OWL staked in the Owl Council governance pool. Open Nesting, stake OWL in the Council governance pool, then vote. After the migration cutoff, legacy council escrow no longer counts toward vote weight.',
      }
    }

    const weightDecimal = formatNestingStakeWeightDecimal(raw, owl.decimals)
    const weightApprox = Number(weightDecimal)
    if (!Number.isFinite(weightApprox)) {
      return { ok: false, code: 'rpc_error', message: 'Could not compute voting weight.' }
    }
    return {
      ok: true,
      weightDecimal,
      weightApprox,
      usedCouncilEscrow: false,
      usedCouncilNesting: true,
    }
  }

  if (isCouncilOwlEscrowVotingEnabled()) {
    const raw = await getOwlCouncilEscrowBalanceRaw(w)
    if (raw <= 0n) {
      return {
        ok: false,
        code: 'no_owl',
        message:
          'No OWL in Owl Council escrow for this wallet. Use the Council escrow panel to deposit OWL, then vote. Your voting weight equals the OWL you keep in escrow—until the migration cutoff, after which weight comes from the Council pool in Nesting.',
      }
    }
    const weightDecimal = owlRawToDecimalString(raw, owl.decimals)
    const weightApprox = Number(weightDecimal)
    if (!Number.isFinite(weightApprox)) {
      return { ok: false, code: 'rpc_error', message: 'Could not compute voting weight.' }
    }
    return {
      ok: true,
      weightDecimal,
      weightApprox,
      usedCouncilEscrow: true,
      usedCouncilNesting: false,
    }
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

  return {
    ok: true,
    weightDecimal,
    weightApprox,
    usedCouncilEscrow: false,
    usedCouncilNesting: false,
  }
}
