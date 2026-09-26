import type { PartnerAllowlistPhase } from '@/lib/owl-center/partner-allowlist-phases'
import {
  partnerPhaseHasHolderGate,
  partnerPhaseHasRedeemTokenBurn,
} from '@/lib/owl-center/partner-allowlist-phases'

export type PartnerPhaseOnChainGate =
  | { kind: 'token_burn'; mint: string; amount: number }
  | { kind: 'allowlist_merkle'; merkleRootBase58: string; walletCount: number }
  | {
      kind: 'holder'
      collectionMint: string
      onePerAsset: boolean
      /** Unique id when using assetMintLimit / nftMintLimit (stable per phase index). */
      mintLimitId?: number
    }

export function partnerPhaseUsesMerkleAllowlist(
  phase: PartnerAllowlistPhase,
  merkleWalletCount: number
): boolean {
  if (partnerPhaseHasRedeemTokenBurn(phase) || partnerPhaseHasHolderGate(phase)) return false
  return merkleWalletCount > 0
}

/**
 * Resolve on-chain gates for a phase. Returns null when no gate is configured (sync must fail).
 */
export function resolvePartnerPhaseOnChainGate(
  phase: PartnerAllowlistPhase,
  opts: {
    merkleRootBase58: string | null
    merkleWalletCount: number
    phaseIndex: number
  }
): PartnerPhaseOnChainGate | null {
  if (partnerPhaseHasRedeemTokenBurn(phase) && phase.redeem_token_mint) {
    const amount = Math.max(1, Math.floor(Number(phase.redeem_token_amount ?? 1)))
    return { kind: 'token_burn', mint: phase.redeem_token_mint.trim(), amount }
  }
  if (partnerPhaseHasHolderGate(phase) && phase.holder_collection_mint) {
    return {
      kind: 'holder',
      collectionMint: phase.holder_collection_mint.trim(),
      onePerAsset: Boolean(phase.holder_one_per_asset),
      mintLimitId: Math.min(255, 10 + Math.max(0, opts.phaseIndex)),
    }
  }
  if (opts.merkleWalletCount > 0 && opts.merkleRootBase58) {
    return {
      kind: 'allowlist_merkle',
      merkleRootBase58: opts.merkleRootBase58,
      walletCount: opts.merkleWalletCount,
    }
  }
  return null
}

export function formatPartnerPhaseGateSyncError(phaseLabel: string): string {
  return `${phaseLabel} has no on-chain gate — add WL wallets, a holder collection, or a Free Mint Token burn before sync/go-live`
}
