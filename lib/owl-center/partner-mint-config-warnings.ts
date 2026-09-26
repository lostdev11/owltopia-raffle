import {
  partnerAllowlistTotalSupply,
  resolvePartnerAllowlistPhases,
  type PartnerAllowlistPhase,
} from '@/lib/owl-center/partner-allowlist-phases'

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

export type PartnerMintConfigWarning = {
  code: string
  message: string
}

type LaunchLike = {
  total_supply: number
  wallet_mint_limit: number
  public_supply: number
  wl_supply?: number
  partner_allowlist_phases?: PartnerAllowlistPhase[] | null
  creator_wl_enabled?: boolean
  phase_schedule?: Partial<Record<string, string>>
}

/** Soft validation warnings for creator/admin mint config (not hard blocks unless noted). */
export function buildPartnerMintConfigWarnings(launch: LaunchLike): PartnerMintConfigWarning[] {
  const warnings: PartnerMintConfigWarning[] = []
  const phases = resolvePartnerAllowlistPhases(launch)
  const totalSupply = Math.max(0, Math.floor(Number(launch.total_supply) || 0))
  const walletLimit = Math.max(1, Math.floor(Number(launch.wallet_mint_limit) || 1))
  const publicMs = parseIsoMs(launch.phase_schedule?.PUBLIC)

  for (const phase of phases) {
    const startMs = parseIsoMs(phase.starts_at)
    if (
      startMs != null &&
      publicMs != null &&
      startMs === publicMs &&
      !phase.concurrent_with_public
    ) {
      warnings.push({
        code: 'wl_public_same_minute',
        message: `${phase.label} and Public start at the same time without “concurrent with public” — the WL window length is zero.`,
      })
    }
    const phaseLimit = phase.wallet_mint_limit ?? walletLimit
    if (phaseLimit >= totalSupply && totalSupply > 0) {
      warnings.push({
        code: 'wallet_limit_ge_supply',
        message: `${phase.label} max per wallet (${phaseLimit}) is at least total supply (${totalSupply}) — one wallet could take the entire phase.`,
      })
    } else if (phaseLimit >= Math.max(1, Math.floor(totalSupply * 0.5)) && totalSupply > 10) {
      warnings.push({
        code: 'wallet_limit_large_vs_supply',
        message: `${phase.label} max per wallet (${phaseLimit}) is large relative to total supply (${totalSupply}).`,
      })
    }
  }

  if (phases.length > 0 && totalSupply > 0) {
    const wlSum = partnerAllowlistTotalSupply(phases)
    const publicSupply = Math.max(0, Math.floor(Number(launch.public_supply) || 0))
    if (wlSum + publicSupply !== totalSupply) {
      warnings.push({
        code: 'phase_supply_split',
        message: `Allowlist phase supplies (${wlSum}) plus public supply (${publicSupply}) do not equal total supply (${totalSupply}).`,
      })
    }
  }

  return warnings
}
