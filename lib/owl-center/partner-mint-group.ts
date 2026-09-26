import { getLaunchWlWallet, sumLaunchWlPhaseUsedMints } from '@/lib/db/owl-center-launch-wl-wallets'
import { fetchWalletNftsInCollectionDas } from '@/lib/helius/fetch-wallet-nfts-in-collection'
import { getHeliusMainnetRpcUrl } from '@/lib/helius-rpc-url'
import {
  partnerPhaseHasHolderGate,
  partnerPhaseHasRedeemTokenBurn,
  partnerPhasePriceSol,
  partnerPhaseSoftRemaining,
  resolvePartnerPhaseWalletMintLimit,
  type PartnerAllowlistPhase,
} from '@/lib/owl-center/partner-allowlist-phases'
import { resolveEffectivePartnerAllowlistPhases } from '@/lib/owl-center/partner-allowlist-phases'
import {
  isPartnerAllowlistPhaseWindowOpen,
  isScheduledPublicMintOpen,
  listOpenPartnerAllowlistPhases,
  resolvePartnerAllowlistPhaseEndDateIso,
} from '@/lib/owl-center/partner-phase-window'
import {
  publicSimpleGuardGroupLabelForLaunch,
  publicSimpleMintGuardGroupLabel,
  PUBLIC_SIMPLE_PUBLIC_GROUP_LABEL,
} from '@/lib/owl-center/public-simple-guard-plan'
import { publicSimpleSolMintPrice } from '@/lib/owl-center/partner-mint-phase-schedule'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { resolveLaunchMintNetwork } from '@/lib/solana/launch-cm'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type PartnerMintGroupPick = {
  phase_key: string | null
  phase_label: string | null
  guard_group_label: string
  from_allowlist: boolean
  price_usdc: number | null
  price_sol: number | null
}

type PickLaunch = Pick<
  OwlCenterLaunchPublic,
  | 'id'
  | 'partner_allowlist_phases'
  | 'creator_wl_enabled'
  | 'wl_supply'
  | 'wl_price_usdc'
  | 'public_price_usdc'
  | 'creator_mint_price'
  | 'creator_mint_currency'
  | 'wallet_mint_limit'
  | 'phase_schedule'
  | 'launch_deadline_at'
  | 'is_paused'
  | 'mint_mode'
  | 'mint_network'
>

async function walletEligibleForOpenPhase(
  launch: PickLaunch,
  wallet: string,
  phase: PartnerAllowlistPhase,
  phaseIndex: number,
  nowMs: number
): Promise<{ ok: true; remaining: number } | { ok: false; reason: string }> {
  if (!isPartnerAllowlistPhaseWindowOpen(phase, phaseIndex, launch, nowMs)) {
    return { ok: false, reason: 'phase_closed' }
  }
  const phaseSupply = Math.max(0, Math.floor(Number(phase.supply) || 0))
  const phaseUsed = await sumLaunchWlPhaseUsedMints(launch.id, phase.key)
  const phaseRemaining = partnerPhaseSoftRemaining(phaseSupply, phaseUsed)
  if (phaseSupply > 0 && phaseRemaining <= 0) {
    return { ok: false, reason: 'phase_sold_out' }
  }

  const effectiveLimit = resolvePartnerPhaseWalletMintLimit(phase, launch.wallet_mint_limit)

  if (partnerPhaseHasRedeemTokenBurn(phase)) {
    return { ok: true, remaining: Math.min(phaseRemaining || effectiveLimit, effectiveLimit) }
  }

  if (partnerPhaseHasHolderGate(phase) && phase.holder_collection_mint) {
    const network = resolveLaunchMintNetwork(launch)
    if (network !== 'mainnet') {
      return { ok: false, reason: 'holder_gate_mainnet_only' }
    }
    const helius = getHeliusMainnetRpcUrl()
    if (!helius) return { ok: false, reason: 'holder_gate_unavailable' }
    const assets = await fetchWalletNftsInCollectionDas(
      helius,
      wallet,
      phase.holder_collection_mint.trim()
    )
    const count = assets.filter((a) => !a.burnt).length
    if (count < 1) {
      return { ok: false, reason: `Need a holder NFT from the configured collection (${phase.label})` }
    }
    const byHoldings = phase.holder_one_per_asset ? count : effectiveLimit
    return {
      ok: true,
      remaining: Math.min(phaseRemaining || byHoldings, byHoldings, effectiveLimit),
    }
  }

  const wlRow = await getLaunchWlWallet(launch.id, wallet, phase.key)
  if (!wlRow) {
    return { ok: false, reason: 'not_on_allowlist' }
  }
  const wlRemaining = Math.max(0, wlRow.allowed_mints - wlRow.used_mints)
  if (wlRemaining <= 0) {
    return { ok: false, reason: 'allowlist_exhausted' }
  }
  return {
    ok: true,
    remaining: Math.min(wlRemaining, phaseRemaining || wlRemaining, effectiveLimit),
  }
}

/**
 * Per-wallet guard group: open WL phase with allocation left, else public when public is open.
 */
export async function resolvePartnerMintGroupForWallet(
  launch: PickLaunch,
  walletRaw: string | null,
  nowMs: number = Date.now()
): Promise<PartnerMintGroupPick & { max_from_phase?: number; block_reason?: string | null }> {
  const wallet = walletRaw?.trim() ? normalizeSolanaWalletAddress(walletRaw.trim()) : null
  const phases = resolveEffectivePartnerAllowlistPhases(launch)
  const publicOpen = isScheduledPublicMintOpen(launch, nowMs)

  const publicPick = (): PartnerMintGroupPick => ({
    phase_key: null,
    phase_label: null,
    guard_group_label: PUBLIC_SIMPLE_PUBLIC_GROUP_LABEL,
    from_allowlist: false,
    price_usdc: launch.public_price_usdc,
    price_sol: publicSimpleSolMintPrice(launch),
  })

  if (!wallet) {
    const open = listOpenPartnerAllowlistPhases(launch, nowMs)
    const phase = open[open.length - 1]?.phase
    if (phase) {
      const price_sol = partnerPhasePriceSol(phase)
      return {
        phase_key: phase.key,
        phase_label: phase.label,
        guard_group_label: publicSimpleGuardGroupLabelForLaunch(launch, phase.key),
        from_allowlist: true,
        price_usdc: price_sol != null ? null : phase.price_usdc ?? launch.wl_price_usdc,
        price_sol,
      }
    }
    return publicPick()
  }

  const openPhases = listOpenPartnerAllowlistPhases(launch, nowMs)
  for (const { phase, index } of openPhases) {
    const elig = await walletEligibleForOpenPhase(launch, wallet, phase, index, nowMs)
    if (elig.ok && elig.remaining > 0) {
      const price_sol = partnerPhasePriceSol(phase)
      return {
        phase_key: phase.key,
        phase_label: phase.label,
        guard_group_label: publicSimpleGuardGroupLabelForLaunch(launch, phase.key),
        from_allowlist: true,
        price_usdc: price_sol != null ? null : phase.price_usdc ?? launch.wl_price_usdc,
        price_sol,
        max_from_phase: elig.remaining,
      }
    }
  }

  if (publicOpen) {
    return { ...publicPick(), max_from_phase: undefined }
  }

  return {
    ...publicPick(),
    from_allowlist: false,
    guard_group_label: publicSimpleMintGuardGroupLabel(launch, null) ?? PUBLIC_SIMPLE_PUBLIC_GROUP_LABEL,
    block_reason: openPhases.length > 0 ? 'not_on_allowlist' : 'public_not_open',
  }
}
