import { auditNestingClaimLedger, type WalletClaimLedgerAudit } from '@/lib/nesting/claim-ledger-audit'
import {
  diagnoseNestingWallet,
  type NestingWalletDiagnostics,
} from '@/lib/nesting/admin-wallet-diagnostics'
import { MIN_OWL_CLAIMABLE_TO_CLAIM } from '@/lib/staking/rewards'
import {
  NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS,
  NESTING_DIAGNOSTIC_MAX_WALLET_MINT_CROSS_CHECKS,
} from '@/lib/nesting/rpc-policy'

export type SupportPlaybookWarning = {
  severity: 'block' | 'caution' | 'info'
  code: string
  title: string
  detail: string
}

export type SupportPlaybookRecommendation = {
  action: string
  detail: string
}

export type SupportPlaybookGuards = {
  /** Catch-up would zero UI claimable without sending SPL — unsafe when user was never paid. */
  block_apply_catch_up: boolean
  block_apply_catch_up_reason: string | null
  /** Full wallet heal would close active nests and wipe unpaid claimable in the app. */
  block_wallet_heal: boolean
  block_wallet_heal_reason: string | null
  /** Heal is appropriate (cross-wallet / orphaned ledger). */
  wallet_heal_recommended: boolean
  /** Catch-up is appropriate (on-chain paid, DB behind). */
  catch_up_recommended: boolean
}

export type AdminSupportPlaybook = {
  wallet: string
  generated_at: string
  claim_audit: WalletClaimLedgerAudit | null
  nest_diagnostics: NestingWalletDiagnostics
  warnings: SupportPlaybookWarning[]
  recommendations: SupportPlaybookRecommendation[]
  guards: SupportPlaybookGuards
}

const CATCH_UP_SAFE_FLAGS = new Set([
  'ledger_behind_onchain_payouts',
  'repeat_onchain_claim_24h',
  'high_claimable_after_recent_payout',
  'position_claimed_above_accrued',
])

function countIssues(
  diagnostics: NestingWalletDiagnostics,
  kind: string
): number {
  return diagnostics.issues.filter((i) => i.kind === kind).length
}

export function buildAdminSupportPlaybook(params: {
  wallet: string
  claimAudit: WalletClaimLedgerAudit | null
  nestDiagnostics: NestingWalletDiagnostics
}): AdminSupportPlaybook {
  const wallet = params.wallet.trim()
  const diag = params.nestDiagnostics
  const audit = params.claimAudit

  const warnings: SupportPlaybookWarning[] = []
  const recommendations: SupportPlaybookRecommendation[] = []

  const activeUnderWallet = diag.positions_under_wallet.active
  const estimatedClaimable = audit?.estimated_claimable_owl ?? 0
  const onchain24h = audit?.onchain_claim_owl_24h ?? 0
  const onchain24hTx = audit?.onchain_claim_tx_count_24h ?? 0
  const significantUnpaid =
    activeUnderWallet > 0 && estimatedClaimable >= MIN_OWL_CLAIMABLE_TO_CLAIM

  const crossWalletCount = diag.cross_wallet_rows.length
  const orphanedActiveCount = countIssues(diag, 'orphaned_active')
  const orphanedPendingCount = countIssues(diag, 'orphaned_pending')
  const ownerThawedCount = countIssues(diag, 'owner_thawed_active')

  const catchUpSafe =
    audit != null && audit.risk_flags.some((f) => CATCH_UP_SAFE_FLAGS.has(f))

  const walletHealRecommended =
    crossWalletCount > 0 || orphanedActiveCount > 0 || orphanedPendingCount > 0

  const catchUpRecommended = catchUpSafe && significantUnpaid

  let blockCatchUp = false
  let blockCatchUpReason: string | null = null
  if (significantUnpaid && !catchUpSafe) {
    blockCatchUp = true
    blockCatchUpReason = `~${estimatedClaimable.toFixed(4)} OWL still shows as claimable with ${onchain24hTx} on-chain claim tx(s) in 24h (${onchain24h.toFixed(4)} OWL). Catch-up would hide unpaid rewards — use only if they already received OWL on-chain.`
    warnings.push({
      severity: 'block',
      code: 'do_not_catch_up_unpaid',
      title: 'Do not apply catch-up',
      detail: blockCatchUpReason,
    })
  } else if (catchUpRecommended) {
    recommendations.push({
      action: 'Apply catch-up (after dry-run)',
      detail: 'Audit shows on-chain payouts ahead of the DB ledger. Dry-run first, then catch-up if amounts match what they were paid.',
    })
  }

  let blockWalletHeal = false
  let blockWalletHealReason: string | null = null
  if (significantUnpaid && !walletHealRecommended) {
    blockWalletHeal = true
    blockWalletHealReason = `${activeUnderWallet} active nest(s) with ~${estimatedClaimable.toFixed(4)} OWL claimable. Full heal would close nests in the DB and remove their claim path without sending OWL.`
    warnings.push({
      severity: 'block',
      code: 'do_not_wallet_heal_unpaid',
      title: 'Do not apply full wallet heal',
      detail: blockWalletHealReason,
    })
  }

  if (walletHealRecommended) {
    recommendations.push({
      action: 'Apply full wallet heal',
      detail: `Clears ledger drift (${crossWalletCount} cross-wallet, ${orphanedActiveCount} orphaned active, ${orphanedPendingCount} orphaned pending). Safe when claimable is zero or user cannot earn until nests are re-opened.`,
    })
  }

  if (audit != null && audit.risk_flags.length > 0) {
    warnings.push({
      severity: audit.risk_flags.some((f) =>
        f === 'ledger_behind_onchain_payouts' || f === 'position_claimed_above_accrued'
      )
        ? 'block'
        : 'caution',
      code: 'claim_ledger_audit_flags',
      title: 'Claim ledger audit',
      detail: audit.risk_summary,
    })
    if (
      !catchUpRecommended &&
      audit.risk_flags.some((f) => CATCH_UP_SAFE_FLAGS.has(f)) &&
      (onchain24h > 0 || audit.ledger_claim_owl_total > 0)
    ) {
      recommendations.push({
        action: 'Review catch-up (dry-run)',
        detail:
          'On-chain claim activity is ahead of per-nest UI claimable. Dry-run catch-up if they were already paid SPL; do not apply if rewards were never sent.',
      })
    }
  }

  if (ownerThawedCount > 0 && significantUnpaid && !walletHealRecommended) {
    recommendations.push({
      action: 'User: Claim all (or per-nest claim)',
      detail: `${ownerThawedCount} nest(s) use Owner-thawed coins — earning/claim does not require re-locking. If Claim all fails, wait for the latest nesting deploy or check RPC errors; do not catch-up or heal.`,
    })
    warnings.push({
      severity: 'caution',
      code: 'owner_thawed_claim_path',
      title: 'Owner-thawed nests — claim, do not heal',
      detail:
        'Coins are thawed under wallet Owner freeze. This is normal. Fixing is a claim/RPC issue, not a ledger reset.',
    })
  }

  if (crossWalletCount > 0) {
    warnings.push({
      severity: 'caution',
      code: 'cross_wallet',
      title: `${crossWalletCount} cross-wallet blocker(s)`,
      detail: 'NFTs are in this wallet but open nest rows exist on another address. Full heal clears those stale rows.',
    })
  }

  if (activeUnderWallet === 0 && diag.wallet_nest_mint_count > 0) {
    warnings.push({
      severity: 'info',
      code: 'no_db_rows',
      title: 'No nests under this wallet in DB',
      detail: 'User may be on a new wallet after transfer, or never completed nest open. Run diagnostics then heal if cross-wallet rows appear.',
    })
  }

  if (warnings.length === 0 && !significantUnpaid && !(audit?.risk_flags.length)) {
    recommendations.push({
      action: 'No high-risk pattern',
      detail: 'If the user still has issues, get the exact error text and one NFT mint address.',
    })
  }

  return {
    wallet,
    generated_at: new Date().toISOString(),
    claim_audit: audit,
    nest_diagnostics: diag,
    warnings,
    recommendations,
    guards: {
      block_apply_catch_up: blockCatchUp,
      block_apply_catch_up_reason: blockCatchUpReason,
      block_wallet_heal: blockWalletHeal,
      block_wallet_heal_reason: blockWalletHealReason,
      wallet_heal_recommended: walletHealRecommended,
      catch_up_recommended: catchUpRecommended,
    },
  }
}

export async function loadAdminSupportPlaybook(wallet: string): Promise<AdminSupportPlaybook> {
  const trimmed = wallet.trim()
  const [auditResult, nestDiagnostics] = await Promise.all([
    auditNestingClaimLedger({ wallet: trimmed, flaggedOnly: false, lookbackHours: 168 }),
    diagnoseNestingWallet(trimmed, {
      maxActiveLockChecks: NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS,
      maxWalletMintCrossChecks: NESTING_DIAGNOSTIC_MAX_WALLET_MINT_CROSS_CHECKS,
      skipLockSamples: true,
    }),
  ])
  const claimAudit =
    auditResult.wallets.find((w) => w.wallet_address === trimmed) ??
    auditResult.wallets[0] ??
    null

  return buildAdminSupportPlaybook({
    wallet: trimmed,
    claimAudit,
    nestDiagnostics,
  })
}
